import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.POSTERN_DIR = mkdtempSync(join(tmpdir(), 'postern-'))
const { joinScript } = await import('./join.ts')

const script = joinScript(
  { token: 'abc', n: 7, privateKey: 'nodeprivate=', expires: 0 },
  443,
  { host: '203.0.113.5', port: 53, publicKey: 'hubpublic=', sshKey: 'ssh-ed25519 AAAAhub postern' },
)

test('the join script is valid sh', () => {
  execFileSync('sh', ['-n'], { input: script })
})

test('the join script runs only once it has arrived whole', () => {
  assert.match(script, /^#!\/bin\/sh\nset -eu\n\nmain\(\) \{\n/)
  assert.match(script, /\n\}\n\nmain\n$/)
})

test('the join script installs wireguard-tools, openssh-server and nftables', () => {
  assert.match(script, /^  apt-get install -y -q wireguard-tools openssh-server nftables$/m)
})

test('the join script turns on forwarding, now and on every boot', () => {
  assert.match(script, /^  echo 'net\.ipv4\.ip_forward = 1' > \/etc\/sysctl\.d\/99-postern\.conf\n  sysctl -q -p \/etc\/sysctl\.d\/99-postern\.conf$/m)
})

test('the join script writes postern0.conf for node n, dialing the hub on its port', () => {
  assert.ok(script.includes(`cat > /etc/wireguard/postern0.conf <<'EOF'
[Interface]
Address = 10.99.0.7/32
PrivateKey = nodeprivate=

[Peer]
PublicKey = hubpublic=
Endpoint = 203.0.113.5:53
AllowedIPs = 10.99.0.1/32
PersistentKeepalive = 25
EOF
`))
  assert.match(script, /^  umask 077$/m)
})

test('the join script lets the hub in over SSH, once', () => {
  assert.match(script, /^  if ! grep -qxF 'ssh-ed25519 AAAAhub postern' \/root\/\.ssh\/authorized_keys 2>\/dev\/null; then\n    echo 'ssh-ed25519 AAAAhub postern' >> \/root\/\.ssh\/authorized_keys\n  fi$/m)
})

test('the join script writes wg0.conf once, listening on port 51820 + n, with a fresh key made on the node', () => {
  assert.ok(script.includes(`  if [ ! -f /etc/wireguard/wg0.conf ]; then
    cat > /etc/wireguard/wg0.conf <<EOF
[Interface]
Address = 10.66.66.1/24
ListenPort = 51827
MTU = 1340
PrivateKey = $(wg genkey)
PostUp = nft add table inet postern; nft add chain inet postern postrouting '{ type nat hook postrouting priority srcnat; }'; nft add rule inet postern postrouting 'ip saddr 10.66.66.0/24 oifname != { "wg0", "postern0" } masquerade'
PostDown = nft delete table inet postern
EOF
  fi
`))
})

test('the join script moves a kept wg0.conf to port 51820 + n', () => {
  assert.match(script, /^  sed -i 's\/\^ListenPort = \.\*\/ListenPort = 51827\/' \/etc\/wireguard\/wg0\.conf$/m)
})

test('the join script moves kept device configs to the node\'s port on the hub', () => {
  assert.match(script, /^  for client in \/etc\/wireguard\/clients\/\*\.conf; do\n    if \[ -f "\$client" \]; then\n      sed -i '\/\^Endpoint = \/s\/:\[0-9\]\*\$\/:443\/' "\$client"\n    fi\n  done$/m)
})

test('the join script starts postern0, ssh and wg0, now and on every boot', () => {
  assert.match(script, /^  systemctl enable wg-quick@postern0\n  systemctl restart wg-quick@postern0\n  systemctl enable --now ssh\n  systemctl enable wg-quick@wg0\n  systemctl restart wg-quick@wg0$/m)
})
