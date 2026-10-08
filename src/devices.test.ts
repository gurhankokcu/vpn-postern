import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, test } from 'node:test'

process.env.POSTERN_DIR = mkdtempSync(join(tmpdir(), 'postern-'))
process.env.PATH = `${join(import.meta.dirname, '..', 'dev', 'bin')}:${process.env.PATH}`
const { addDevice, addScript, clientConf, devices, freeX, listDevices, movePort, peer, portScript, qr, removeDevice, removeScript, renameDevice, renameScript, showDevice, withName, withoutDevice } = await import('./devices.ts')
const dir = process.env.POSTERN_DIR
const node = { name: 'home', n: 2, port: 443, publicKey: 'key' }

const server = `[Interface]
Address = 10.66.66.1/24
ListenPort = 51822
MTU = 1340
PrivateKey = privateserver
PostUp = nft add table inet postern
PostDown = nft delete table inet postern
`
const twoDevices = `${server}
### Client mum
[Peer]
PublicKey = mumpublic
AllowedIPs = 10.66.66.2/32

### Client Dad-Phone
[Peer]
PublicKey = dadpublic
AllowedIPs = 10.66.66.4/32
`
const full = `${server}\n${Array.from({ length: 253 }, (_, i) => `[Peer]\nAllowedIPs = 10.66.66.${i + 2}/32\n`).join('\n')}`

beforeEach(() => {
  for (const file of ['ssh.log', 'ssh.out', 'ssh.code', 'wg.log', 'qrencode.log']) {
    rmSync(join(dir, file), { force: true })
  }
})

function answer(stdout: string, code = 0) {
  writeFileSync(join(dir, 'ssh.out'), stdout)
  writeFileSync(join(dir, 'ssh.code'), String(code))
}

function sshLog() {
  return readFileSync(join(dir, 'ssh.log'), 'utf8')
}

test('devices reads each client block\'s name and address', () => {
  assert.deepEqual(devices(twoDevices), [{ name: 'mum', x: 2, online: false }, { name: 'Dad-Phone', x: 4, online: false }])
})

test('a device is online when it has shaken hands with the node in the last 3 minutes', () => {
  const seen = new Map([['mumpublic', Date.now() - 60_000], ['dadpublic', Date.now() - 240_000]])
  assert.deepEqual(devices(twoDevices, seen).map((device) => device.online), [true, false])
})

test('a wg0.conf with no client blocks has no devices', () => {
  assert.deepEqual(devices(server), [])
})

test('freeX is the lowest address from 2 that no peer holds', () => {
  assert.equal(freeX(server), 2)
  assert.equal(freeX(twoDevices), 3)
  assert.equal(freeX(`${twoDevices}\n[Peer]\nPublicKey = other\nAllowedIPs = 10.66.66.3/32\n`), 5)
})

test('an address is read from a list with an IPv6 address, as wireguard-install writes', () => {
  const conf = `${server}\n### Client mum\n[Peer]\nPublicKey = mumpublic\nAllowedIPs = 10.66.66.2/32,fd42:42:42::2/128\n\n[Peer]\nAllowedIPs = fd42:42:42::4/128, 10.66.66.3/32\n`
  assert.deepEqual(devices(conf), [{ name: 'mum', x: 2, online: false }])
  assert.equal(freeX(conf), 4)
})

test('freeX is null once 2 to 254 are all held', () => {
  assert.equal(freeX(full), null)
})

test('peer is a client block, set apart by a blank line', () => {
  assert.equal(peer('mum', 'mumpublic', 2), `
### Client mum
[Peer]
PublicKey = mumpublic
AllowedIPs = 10.66.66.2/32
`)
  assert.deepEqual(devices(server + peer('mum', 'mumpublic', 2)), [{ name: 'mum', x: 2, online: false }])
})

test('clientConf sends everything through the node, at the MTU that fits inside postern0', () => {
  assert.equal(clientConf('mumprivate', 2, 'serverpublic', 'hub.example:51822'), `[Interface]
PrivateKey = mumprivate
Address = 10.66.66.2/32
DNS = 1.1.1.1, 1.0.0.1
MTU = 1340

[Peer]
PublicKey = serverpublic
Endpoint = hub.example:51822
AllowedIPs = 0.0.0.0/0, ::/0
`)
})

test('addScript is valid sh that writes both files privately, then applies the peers live', () => {
  const script = addScript('mum', 'WG0\n', 'CLIENT\n')
  execFileSync('sh', ['-n'], { input: script })
  assert.equal(script, `set -eu
umask 077
mkdir -p /etc/wireguard/clients
cat > /etc/wireguard/clients/mum.conf.tmp <<'EOF'
CLIENT
EOF
cat > /etc/wireguard/wg0.conf.tmp <<'EOF'
WG0
EOF
mv /etc/wireguard/clients/mum.conf.tmp /etc/wireguard/clients/mum.conf
mv /etc/wireguard/wg0.conf.tmp /etc/wireguard/wg0.conf
wg-quick strip wg0 | wg syncconf wg0 /dev/stdin
`)
})

test('withoutDevice drops the device\'s block and the blank line before it, leaving the rest byte for byte', () => {
  assert.equal(withoutDevice(twoDevices, 'mum'), `${server}
### Client Dad-Phone
[Peer]
PublicKey = dadpublic
AllowedIPs = 10.66.66.4/32
`)
  assert.equal(withoutDevice(twoDevices, 'Dad-Phone'), `${server}
### Client mum
[Peer]
PublicKey = mumpublic
AllowedIPs = 10.66.66.2/32
`)
})

test('withoutDevice undoes adding a device exactly', () => {
  assert.equal(withoutDevice(twoDevices + peer('tablet', 'tabletpublic', 3), 'tablet'), twoDevices)
  assert.equal(withoutDevice(withoutDevice(twoDevices, 'Dad-Phone')!, 'mum'), server)
})

test('withoutDevice stops at the blank line that ends the block', () => {
  const conf = `${server}\n### Client mum\n[Peer]\nPublicKey = mumpublic\nAllowedIPs = 10.66.66.2/32\n\n[Peer]\nPublicKey = other\nAllowedIPs = 10.66.66.3/32\n`
  assert.equal(withoutDevice(conf, 'mum'), `${server}\n[Peer]\nPublicKey = other\nAllowedIPs = 10.66.66.3/32\n`)
})

test('withoutDevice is null for a name with no block, in any other case too', () => {
  assert.equal(withoutDevice(twoDevices, 'tablet'), null)
  assert.equal(withoutDevice(twoDevices, 'MUM'), null)
})

test('removeScript is valid sh that writes wg0.conf privately, deletes the device\'s config, then applies the peers live', () => {
  const script = removeScript('mum', 'WG0\n')
  execFileSync('sh', ['-n'], { input: script })
  assert.equal(script, `set -eu
umask 077
cat > /etc/wireguard/wg0.conf.tmp <<'EOF'
WG0
EOF
mv /etc/wireguard/wg0.conf.tmp /etc/wireguard/wg0.conf
rm -f /etc/wireguard/clients/mum.conf
wg-quick strip wg0 | wg syncconf wg0 /dev/stdin
`)
})

test('withName changes only the device\'s name line, leaving the rest byte for byte', () => {
  assert.equal(withName(twoDevices, 'mum', 'Mum-Phone'), twoDevices.replace('### Client mum\n', '### Client Mum-Phone\n'))
})

test('withName is null for a name with no block, in any other case too', () => {
  assert.equal(withName(twoDevices, 'tablet', 'laptop'), null)
  assert.equal(withName(twoDevices, 'MUM', 'laptop'), null)
})

test('renameScript is valid sh that writes wg0.conf privately and moves the device\'s config, if it has one', () => {
  const script = renameScript('mum', 'Mum-Phone', 'WG0\n')
  execFileSync('sh', ['-n'], { input: script })
  assert.equal(script, `set -eu
umask 077
cat > /etc/wireguard/wg0.conf.tmp <<'EOF'
WG0
EOF
mv /etc/wireguard/wg0.conf.tmp /etc/wireguard/wg0.conf
if [ -f /etc/wireguard/clients/mum.conf ]; then
  mv /etc/wireguard/clients/mum.conf /etc/wireguard/clients/Mum-Phone.conf
fi
`)
})

test('portScript is valid sh that moves the Endpoint port in every client config', () => {
  const script = portScript(443)
  execFileSync('sh', ['-n'], { input: script })
  assert.equal(script, `set -eu
for client in /etc/wireguard/clients/*.conf; do
  if [ -f "$client" ]; then
    sed -i '/^Endpoint = /s/:[0-9]*$/:443/' "$client"
  fi
done
`)
})

test('qr encodes the text as an svg, without the XML prolog', () => {
  assert.equal(qr('CLIENT\n'), '<svg>qr</svg>\n')
  assert.equal(readFileSync(join(dir, 'qrencode.log'), 'utf8'), 'qrencode -t svg -o -\nCLIENT\n')
})

test('listDevices reads wg0.conf and the devices\' handshakes on the node', async () => {
  answer(`${twoDevices}### Handshakes\nmumpublic\t${Math.floor(Date.now() / 1000)}\ndadpublic\t0\n`)
  assert.deepEqual(await listDevices(node), [{ name: 'mum', x: 2, online: true }, { name: 'Dad-Phone', x: 4, online: false }])
  assert.match(sshLog(), /root@10\.99\.0\.2 cat \/etc\/wireguard\/wg0\.conf && echo '### Handshakes' && wg show wg0 latest-handshakes\n$/)
})

test('listDevices is null when the node cannot be reached', async () => {
  answer('', 255)
  assert.equal(await listDevices(node), null)
})

test('addDevice writes the next free address to the node, with keys made on the hub, dialing the node\'s port', async () => {
  answer(twoDevices)
  assert.equal(await addDevice(node, 'tablet', 'hub.example'), 'added')
  const [, write] = sshLog().split(/^ssh .*root@10\.99\.0\.2 sh\n/m)
  assert.equal(write, addScript('tablet', twoDevices + peer('tablet', 'public2', 3), clientConf('private2', 3, 'publicserver', 'hub.example:443')))
})

test('addDevice runs one change at a time on a node', async () => {
  answer(twoDevices)
  assert.deepEqual(await Promise.all([addDevice(node, 'tablet', 'hub.example'), addDevice(node, 'laptop', 'hub.example')]), ['added', 'added'])
  assert.deepEqual(sshLog().match(/^ssh .* (cat \/etc\/wireguard\/wg0\.conf|sh)$/gm)?.map((line) => line.split(' ').at(-1)), ['/etc/wireguard/wg0.conf', 'sh', '/etc/wireguard/wg0.conf', 'sh'])
})

test('addDevice refuses a name already on the node, in any case, writing nothing', async () => {
  answer(twoDevices)
  assert.equal(await addDevice(node, 'dad-phone', 'hub.example'), 'taken')
  assert.equal(sshLog().match(/^ssh /gm)?.length, 1)
})

test('addDevice refuses once the node has no free address, writing nothing', async () => {
  answer(full)
  assert.equal(await addDevice(node, 'tablet', 'hub.example'), 'full')
  assert.equal(sshLog().match(/^ssh /gm)?.length, 1)
})

test('addDevice is offline when the node cannot be reached', async () => {
  answer('', 255)
  assert.equal(await addDevice(node, 'tablet', 'hub.example'), 'offline')
})

test('removeDevice writes wg0.conf without the device to the node', async () => {
  answer(twoDevices)
  assert.equal(await removeDevice(node, 'mum'), 'removed')
  const [, write] = sshLog().split(/^ssh .*root@10\.99\.0\.2 sh\n/m)
  assert.equal(write, removeScript('mum', withoutDevice(twoDevices, 'mum')!))
})

test('removeDevice is missing for a device not on the node, writing nothing', async () => {
  answer(twoDevices)
  assert.equal(await removeDevice(node, 'tablet'), 'missing')
  assert.equal(sshLog().match(/^ssh /gm)?.length, 1)
})

test('removeDevice is offline when the node cannot be reached', async () => {
  answer('', 255)
  assert.equal(await removeDevice(node, 'mum'), 'offline')
})

test('removeDevice waits for an add on the same node', async () => {
  answer(twoDevices)
  await Promise.all([addDevice(node, 'tablet', 'hub.example'), removeDevice(node, 'mum')])
  assert.deepEqual(sshLog().match(/^ssh .* (cat \/etc\/wireguard\/wg0\.conf|sh)$/gm)?.map((line) => line.split(' ').at(-1)), ['/etc/wireguard/wg0.conf', 'sh', '/etc/wireguard/wg0.conf', 'sh'])
})

test('renameDevice writes wg0.conf with the new name to the node', async () => {
  answer(twoDevices)
  assert.equal(await renameDevice(node, 'mum', 'Mum-Phone'), 'renamed')
  const [, write] = sshLog().split(/^ssh .*root@10\.99\.0\.2 sh\n/m)
  assert.equal(write, renameScript('mum', 'Mum-Phone', withName(twoDevices, 'mum', 'Mum-Phone')!))
})

test('renameDevice keeping the same name only reads the node', async () => {
  answer(twoDevices)
  assert.equal(await renameDevice(node, 'mum', 'mum'), 'renamed')
  assert.equal(sshLog().match(/^ssh /gm)?.length, 1)
})

test('renameDevice lets a device change only the case of its own name', async () => {
  answer(twoDevices)
  assert.equal(await renameDevice(node, 'mum', 'MUM'), 'renamed')
})

test('renameDevice refuses a name another device on the node has, in any case, writing nothing', async () => {
  answer(twoDevices)
  assert.equal(await renameDevice(node, 'mum', 'dad-phone'), 'taken')
  assert.equal(sshLog().match(/^ssh /gm)?.length, 1)
})

test('renameDevice is missing for a device not on the node, writing nothing', async () => {
  answer(twoDevices)
  assert.equal(await renameDevice(node, 'tablet', 'laptop'), 'missing')
  assert.equal(sshLog().match(/^ssh /gm)?.length, 1)
})

test('renameDevice is offline when the node cannot be reached', async () => {
  answer('', 255)
  assert.equal(await renameDevice(node, 'mum', 'Mum-Phone'), 'offline')
})

test('renameDevice waits for an add on the same node', async () => {
  answer(twoDevices)
  await Promise.all([addDevice(node, 'tablet', 'hub.example'), renameDevice(node, 'mum', 'Mum-Phone')])
  assert.deepEqual(sshLog().match(/^ssh .* (cat \/etc\/wireguard\/wg0\.conf|sh)$/gm)?.map((line) => line.split(' ').at(-1)), ['/etc/wireguard/wg0.conf', 'sh', '/etc/wireguard/wg0.conf', 'sh'])
})

test('showDevice reads the device\'s config on the node', async () => {
  answer('CLIENT\n')
  assert.equal(await showDevice(node, 'mum'), 'CLIENT\n')
  assert.match(sshLog(), /root@10\.99\.0\.2 cat \/etc\/wireguard\/clients\/mum\.conf\n$/)
})

test('showDevice tells a missing device from an offline node', async () => {
  answer('', 1)
  assert.equal(await showDevice(node, 'mum'), 'missing')
  answer('', 255)
  assert.equal(await showDevice(node, 'mum'), 'offline')
})

test('movePort runs portScript on the node', async () => {
  answer('')
  assert.equal(await movePort(node, 443), 'moved')
  const [, script] = sshLog().split(/^ssh .*root@10\.99\.0\.2 sh\n/m)
  assert.equal(script, portScript(443))
})

test('movePort is offline when the node cannot be reached', async () => {
  answer('', 255)
  assert.equal(await movePort(node, 443), 'offline')
})

test('movePort waits for an add on the same node', async () => {
  answer(twoDevices)
  await Promise.all([addDevice(node, 'tablet', 'hub.example'), movePort(node, 443)])
  assert.match(sshLog(), /root@10\.99\.0\.2 sh\nset -eu\numask 077\n[\s\S]*root@10\.99\.0\.2 sh\nset -eu\nfor client/)
})
