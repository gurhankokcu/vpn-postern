import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, test } from 'node:test'

process.env.POSTERN_DIR = mkdtempSync(join(tmpdir(), 'postern-'))
process.env.PATH = `${join(import.meta.dirname, '..', 'dev', 'bin')}:${process.env.PATH}`
const { addDevice, clientConf, devices, freeX, listDevices, peer, qr, showDevice, writeScript } = await import('./devices.ts')
const dir = process.env.POSTERN_DIR
const node = { name: 'home', n: 2, publicKey: 'key' }

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
  assert.deepEqual(devices(twoDevices), [{ name: 'mum', x: 2 }, { name: 'Dad-Phone', x: 4 }])
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
  assert.deepEqual(devices(conf), [{ name: 'mum', x: 2 }])
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
  assert.deepEqual(devices(server + peer('mum', 'mumpublic', 2)), [{ name: 'mum', x: 2 }])
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

test('writeScript is valid sh that writes both files privately, then applies the peers live', () => {
  const script = writeScript('mum', 'WG0\n', 'CLIENT\n')
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

test('qr encodes the text as an svg, without the XML prolog', () => {
  assert.equal(qr('CLIENT\n'), '<svg>qr</svg>\n')
  assert.equal(readFileSync(join(dir, 'qrencode.log'), 'utf8'), 'qrencode -t svg -o -\nCLIENT\n')
})

test('listDevices reads wg0.conf on the node', async () => {
  answer(twoDevices)
  assert.deepEqual(await listDevices(node), [{ name: 'mum', x: 2 }, { name: 'Dad-Phone', x: 4 }])
  assert.match(sshLog(), /root@10\.99\.0\.2 cat \/etc\/wireguard\/wg0\.conf\n$/)
})

test('listDevices is null when the node cannot be reached', async () => {
  answer('', 255)
  assert.equal(await listDevices(node), null)
})

test('addDevice writes the next free address to the node, with keys made on the hub', async () => {
  answer(twoDevices)
  assert.equal(await addDevice(node, 'tablet', 'hub.example'), 'added')
  const [, write] = sshLog().split(/^ssh .*root@10\.99\.0\.2 sh\n/m)
  assert.equal(write, writeScript('tablet', twoDevices + peer('tablet', 'public2', 3), clientConf('private2', 3, 'publicserver', 'hub.example:51822')))
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
