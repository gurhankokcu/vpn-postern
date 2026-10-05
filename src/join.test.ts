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
  { host: '203.0.113.5', publicKey: 'hubpublic=', sshKey: 'ssh-ed25519 AAAAhub postern' },
)

test('the join script is valid sh', () => {
  execFileSync('sh', ['-n'], { input: script })
})

test('the join script runs only once it has arrived whole', () => {
  assert.match(script, /^#!\/bin\/sh\nset -eu\n\nmain\(\) \{\n/)
  assert.match(script, /\n\}\n\nmain\n$/)
})

test('the join script installs wireguard-tools and openssh-server', () => {
  assert.match(script, /^  apt-get install -y -q wireguard-tools openssh-server$/m)
})

test('the join script writes postern0.conf for node n, dialing the hub', () => {
  assert.ok(script.includes(`cat > /etc/wireguard/postern0.conf <<'EOF'
[Interface]
Address = 10.99.0.7/32
PrivateKey = nodeprivate=

[Peer]
PublicKey = hubpublic=
Endpoint = 203.0.113.5:51820
AllowedIPs = 10.99.0.1/32
PersistentKeepalive = 25
EOF
`))
  assert.match(script, /^  umask 077$/m)
})

test('the join script lets the hub in over SSH, once', () => {
  assert.match(script, /^  if ! grep -qxF 'ssh-ed25519 AAAAhub postern' \/root\/\.ssh\/authorized_keys 2>\/dev\/null; then\n    echo 'ssh-ed25519 AAAAhub postern' >> \/root\/\.ssh\/authorized_keys\n  fi$/m)
})

test('the join script starts postern0 and ssh, now and on every boot', () => {
  assert.match(script, /^  systemctl enable wg-quick@postern0\n  systemctl restart wg-quick@postern0\n  systemctl enable --now ssh$/m)
})
