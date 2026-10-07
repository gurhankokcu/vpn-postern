import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, test } from 'node:test'

process.env.POSTERN_DIR = mkdtempSync(join(tmpdir(), 'postern-'))
process.env.PATH = `${join(import.meta.dirname, '..', 'dev', 'bin')}:${process.env.PATH}`
const { load, save } = await import('./data.ts')
const { addNode, changeHubPort, changePort, dropJoin, findJoin, offlineNodes, portProblem, removeNode, stageScript, switchScript, unstageScript } = await import('./nodes.ts')
const { ruleset } = await import('./nft.ts')
const log = join(process.env.POSTERN_DIR, 'wg.log')
const table = join(process.env.POSTERN_DIR, 'nft')
const knownHosts = join(process.env.POSTERN_DIR, 'known_hosts')
const listenPort = join(process.env.POSTERN_DIR, 'listen-port')
const sshLog = join(process.env.POSTERN_DIR, 'ssh.log')
const sshCode = join(process.env.POSTERN_DIR, 'ssh.code')
const handshakes = join(process.env.POSTERN_DIR, 'handshakes')
const busyPort = join(process.env.POSTERN_DIR, 'busy-port')

beforeEach(() => {
  save({ password: 'salt:key', nodes: [], joins: [] })
  rmSync(log, { force: true })
  rmSync(table, { force: true })
  rmSync(listenPort, { force: true })
  rmSync(sshLog, { force: true })
  rmSync(sshCode, { force: true })
  rmSync(handshakes, { force: true })
  rmSync(busyPort, { force: true })
})

test('the first node is n 2, as the hub is 10.99.0.1', () => {
  addNode('home')
  assert.deepEqual(load().nodes.map((node) => node.n), [2])
})

test('a node takes the lowest free n', () => {
  save({ password: '', nodes: [{ name: 'a', n: 2, port: 51822, publicKey: 'key' }, { name: 'c', n: 4, port: 51824, publicKey: 'key' }], joins: [] })
  addNode('b')
  addNode('d')
  assert.deepEqual(load().nodes.map((node) => [node.name, node.n]), [['a', 2], ['c', 4], ['b', 3], ['d', 5]])
})

test('a name already in use, in any case, is refused', () => {
  assert.equal(addNode('Home Pi'), 'added')
  assert.equal(addNode('Home Pi'), 'taken')
  assert.equal(addNode('home pi'), 'taken')
  assert.equal(addNode('HOME PI'), 'taken')
  assert.deepEqual(load().nodes.map((node) => node.name), ['Home Pi'])
})

test('254 is the last n', () => {
  const nodes = Array.from({ length: 252 }, (_, i) => ({ name: `node${i + 2}`, n: i + 2, port: 51822 + i, publicKey: 'key' }))
  save({ password: '', nodes, joins: [] })
  assert.equal(addNode('last'), 'added')
  assert.deepEqual(load().nodes.at(-1), { name: 'last', n: 254, port: 52074, publicKey: 'public2' })
  assert.equal(addNode('extra'), 'full')
  assert.equal(load().nodes.length, 253)
})

test('a node keeps the public key of a fresh keypair', () => {
  addNode('home')
  assert.deepEqual(load().nodes, [{ name: 'home', n: 2, port: 51822, publicKey: 'public2' }])
})

test('the peer joins postern0 live and is saved to its conf', () => {
  addNode('home')
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), [
    'wg show postern0 listen-port',
    'wg genkey',
    'wg pubkey',
    'wg set postern0 peer public2 allowed-ips 10.99.0.2/32',
    'wg-quick save postern0',
  ])
})

test('a node takes 51820 + n as its port by default', () => {
  addNode('home')
  addNode('work')
  assert.deepEqual(load().nodes.map((node) => node.port), [51822, 51823])
})

test('a node keeps the port it is given', () => {
  assert.equal(addNode('home', 443), 'added')
  assert.deepEqual(load().nodes.map((node) => [node.n, node.port]), [[2, 443]])
})

test('a default port another node took is passed over for the next free one', () => {
  addNode('home', 51823)
  addNode('work')
  assert.deepEqual(load().nodes.map((node) => [node.n, node.port]), [[2, 51823], [3, 51824]])
})

test('a port outside 1 to 65535 is refused', () => {
  for (const port of [0, -1, 65536, 1.5, Number.NaN]) {
    assert.equal(addNode('home', port), 'port-invalid', String(port))
  }
  for (const port of [1, 53, 443, 65535]) {
    assert.equal(portProblem(51820, [], port), null, String(port))
  }
  assert.deepEqual(load().nodes, [])
})

test('the hub\'s port, as postern0 listens on it, is taken, and 51820 is free once the hub moves off it', () => {
  assert.equal(addNode('home', 51820), 'port-taken')
  writeFileSync(listenPort, '443\n')
  assert.equal(addNode('home', 443), 'port-taken')
  assert.equal(addNode('home', 51820), 'added')
})

test('a default port passes over the hub\'s port', () => {
  writeFileSync(listenPort, '51822\n')
  addNode('home')
  assert.deepEqual(load().nodes.map((node) => [node.n, node.port]), [[2, 51823]])
})

test('a port another node uses is refused', () => {
  addNode('home', 443)
  assert.equal(addNode('work', 443), 'port-taken')
  assert.deepEqual(load().nodes.map((node) => node.name), ['home'])
})

test('a refused node makes no keys and no peer', () => {
  addNode('home')
  rmSync(log)
  assert.equal(addNode('HOME'), 'taken')
  assert.equal(addNode('work', 0), 'port-invalid')
  assert.equal(addNode('work', 51822), 'port-taken')
  save({ password: '', nodes: Array.from({ length: 253 }, (_, i) => ({ name: `node${i + 2}`, n: i + 2, port: 51822 + i, publicKey: 'key' })), joins: [] })
  assert.equal(addNode('extra'), 'full')
  assert.deepEqual(new Set(readFileSync(log, 'utf8').trim().split('\n')), new Set(['wg show postern0 listen-port']))
})

test('adding a node rebuilds the forwards from data.json', () => {
  addNode('home')
  addNode('work')
  assert.equal(readFileSync(table, 'utf8'), ruleset(load().nodes))
})

test('a refused node leaves the forwards alone', () => {
  addNode('home')
  rmSync(table)
  assert.equal(addNode('HOME'), 'taken')
  assert.equal(existsSync(table), false)
})

test('the node keeps its public key, its join the private one', () => {
  addNode('home')
  const { nodes, joins } = load()
  assert.deepEqual(nodes, [{ name: 'home', n: 2, port: 51822, publicKey: 'public2' }])
  assert.deepEqual(joins.map((join) => [join.n, join.privateKey]), [[2, 'private2']])
})

test('the join token is 32 random bytes in hex, good for an hour', () => {
  const before = Date.now()
  addNode('home')
  addNode('work')
  const [home, work] = load().joins
  assert.match(home.token, /^[0-9a-f]{64}$/)
  assert.notEqual(home.token, work.token)
  assert.ok(home.expires >= before + 60 * 60 * 1000)
  assert.ok(home.expires <= Date.now() + 60 * 60 * 1000)
})

test('a refused node makes no join', () => {
  addNode('home')
  assert.equal(addNode('HOME'), 'taken')
  assert.equal(load().joins.length, 1)
})

test('adding a node drops expired joins', () => {
  const nodes = [{ name: 'old', n: 5, port: 51825, publicKey: 'key' }, { name: 'new', n: 6, port: 51826, publicKey: 'key' }]
  const joins = [{ token: 'old', n: 5, privateKey: 'key', expires: Date.now() - 1 }, { token: 'new', n: 6, privateKey: 'key', expires: Date.now() + 60_000 }]
  save({ password: '', nodes, joins })
  addNode('home')
  assert.deepEqual(load().joins.map((join) => join.n), [6, 2])
})

test('removing a node takes its peer off postern0, live and in its conf', () => {
  addNode('home')
  assert.equal(removeNode(2), 'removed')
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n').slice(5), [
    'wg set postern0 peer public2 remove',
    'wg-quick save postern0',
  ])
})

test('removing a node drops it and its join, keeps the rest, and drops expired joins', () => {
  const nodes = [{ name: 'home', n: 2, port: 51822, publicKey: 'home' }, { name: 'work', n: 3, port: 51823, publicKey: 'work' }]
  const joins = [{ token: 'home', n: 2, privateKey: 'key', expires: Date.now() + 60_000 }, { token: 'work', n: 3, privateKey: 'key', expires: Date.now() + 60_000 }, { token: 'old', n: 4, privateKey: 'key', expires: Date.now() - 1 }]
  save({ password: 'salt:key', nodes, joins })
  removeNode(2)
  assert.deepEqual(load(), { password: 'salt:key', nodes: [nodes[1]], joins: [joins[1]] })
})

test('removing a node rebuilds the forwards without it', () => {
  addNode('home')
  addNode('work')
  removeNode(2)
  assert.equal(readFileSync(table, 'utf8'), ruleset([{ name: 'work', n: 3, port: 51823, publicKey: 'public5' }]))
})

test('removing a node forgets its host key', () => {
  addNode('home')
  writeFileSync(knownHosts, '10.99.0.2 ssh-ed25519 AAAAhome\n')
  removeNode(2)
  assert.equal(readFileSync(knownHosts, 'utf8'), '')
})

test('a removed node frees its n and its name', () => {
  addNode('home')
  addNode('work')
  removeNode(2)
  assert.equal(addNode('home'), 'added')
  assert.deepEqual(load().nodes.map((node) => [node.name, node.n]), [['work', 3], ['home', 2]])
})

test('removing an unknown node runs no wg and no nft, and changes nothing', () => {
  addNode('home')
  rmSync(log)
  rmSync(table)
  const before = load()
  assert.equal(removeNode(3), 'missing')
  assert.equal(existsSync(log), false)
  assert.equal(existsSync(table), false)
  assert.deepEqual(load(), before)
})

test('changing a port moves the devices\' configs on the node, then saves it and rebuilds the forwards', async () => {
  addNode('home')
  addNode('work')
  save({ ...load(), joins: [] })
  assert.equal(await changePort(2, 443), 'changed')
  assert.match(readFileSync(sshLog, 'utf8'), /root@10\.99\.0\.2 sh\nset -eu\nfor client in [^\n]*\n.*\n.*:443\//)
  assert.deepEqual(load().nodes.map((node) => [node.n, node.port]), [[2, 443], [3, 51823]])
  assert.equal(readFileSync(table, 'utf8'), ruleset(load().nodes))
})

test('a node may keep its own port', async () => {
  addNode('home')
  assert.equal(await changePort(2, 51822), 'changed')
})

test('a port against the rule, the hub\'s or another node\'s is refused, reaching no node and changing nothing', async () => {
  addNode('home')
  addNode('work')
  rmSync(table)
  const before = load()
  assert.equal(await changePort(2, 0), 'port-invalid')
  assert.equal(await changePort(2, 51820), 'port-taken')
  assert.equal(await changePort(2, 51823), 'port-taken')
  assert.equal(existsSync(sshLog), false)
  assert.equal(existsSync(table), false)
  assert.deepEqual(load(), before)
})

test('a node that cannot be reached keeps its port and its forward', async () => {
  addNode('home')
  save({ ...load(), joins: [] })
  rmSync(table)
  writeFileSync(sshCode, '255')
  assert.equal(await changePort(2, 443), 'offline')
  assert.deepEqual(load().nodes.map((node) => node.port), [51822])
  assert.equal(existsSync(table), false)
})

test('a node still waiting to join changes its port without being reached', async () => {
  addNode('home')
  writeFileSync(sshCode, '255')
  assert.equal(await changePort(2, 443), 'changed')
  assert.equal(existsSync(sshLog), false)
  assert.deepEqual(load().nodes.map((node) => node.port), [443])
  assert.equal(readFileSync(table, 'utf8'), ruleset(load().nodes))
})

test('changing an unknown node\'s port is missing, reaching no node', async () => {
  assert.equal(await changePort(9, 443), 'missing')
  assert.equal(existsSync(sshLog), false)
})

const home = { name: 'home', n: 2, port: 51822, publicKey: 'home' }
const work = { name: 'work', n: 3, port: 51823, publicKey: 'work' }

function seen(...keys: string[]) {
  writeFileSync(handshakes, keys.map((key) => `${key}\t${Math.floor(Date.now() / 1000)}\n`).join(''))
}

function reached() {
  return readFileSync(sshLog, 'utf8').match(/root@10\.99\.0\.\d+(?= sh$)/gm)?.sort()
}

test('stageScript is valid sh that writes postern0.conf with the new port beside it, privately', () => {
  execFileSync('sh', ['-n'], { input: stageScript(443) })
  assert.equal(stageScript(443), `set -eu
umask 077
sed '/^Endpoint = /s/:[0-9]*$/:443/' /etc/wireguard/postern0.conf > /etc/wireguard/postern0.conf.next
`)
})

test('switchScript is valid sh that puts the staged conf in place and applies it on a timer', () => {
  execFileSync('sh', ['-n'], { input: switchScript })
  execFileSync('sh', ['-n'], { input: unstageScript })
  assert.equal(switchScript, `set -eu
mv /etc/wireguard/postern0.conf.next /etc/wireguard/postern0.conf
systemd-run --quiet --on-active=3 sh -c 'wg-quick strip postern0 | wg syncconf postern0 /dev/stdin'
`)
  assert.equal(unstageScript, 'rm -f /etc/wireguard/postern0.conf.next\n')
})

test('offline nodes are the joined ones without a recent handshake', () => {
  save({ password: '', nodes: [home, work, { ...work, name: 'new', n: 4, publicKey: 'new' }], joins: [{ token: 'abc', n: 4, privateKey: 'key', expires: Date.now() + 60_000 }] })
  seen('home')
  assert.deepEqual(offlineNodes().map((node) => node.name), ['work'])
})

test('changing the hub\'s port stages it on every joined node, then switches them and moves the hub', async () => {
  save({ password: '', nodes: [home, work, { ...work, name: 'new', n: 4, port: 51824, publicKey: 'new' }], joins: [{ token: 'abc', n: 4, privateKey: 'key', expires: Date.now() + 60_000 }] })
  seen('home', 'work')
  assert.equal(await changeHubPort(443), 'changed')
  assert.deepEqual(reached(), ['root@10.99.0.2', 'root@10.99.0.2', 'root@10.99.0.3', 'root@10.99.0.3'])
  const ssh = readFileSync(sshLog, 'utf8')
  assert.equal(ssh.split(stageScript(443)).length, 3)
  assert.equal(ssh.split(switchScript).length, 3)
  assert.ok(ssh.lastIndexOf(stageScript(443)) < ssh.indexOf(switchScript))
  assert.match(readFileSync(log, 'utf8'), /^wg set postern0 listen-port 443\nwg-quick save postern0\n$/m)
  assert.equal(readFileSync(listenPort, 'utf8'), '443\n')
})

test('the hub keeping its port changes nothing', async () => {
  save({ password: '', nodes: [home], joins: [] })
  assert.equal(await changeHubPort(51820), 'changed')
  assert.equal(existsSync(sshLog), false)
  assert.equal(existsSync(listenPort), false)
})

test('the hub\'s port against the rule, or a node\'s, is refused, reaching no node', async () => {
  save({ password: '', nodes: [home], joins: [] })
  seen('home')
  assert.equal(await changeHubPort(0), 'port-invalid')
  assert.equal(await changeHubPort(51822), 'port-taken')
  assert.equal(existsSync(sshLog), false)
  assert.equal(existsSync(listenPort), false)
})

test('the hub\'s port waits for every joined node to be online, reaching none', async () => {
  save({ password: '', nodes: [home, work], joins: [] })
  seen('home')
  assert.deepEqual(await changeHubPort(443), [work])
  assert.equal(existsSync(sshLog), false)
  assert.equal(existsSync(listenPort), false)
})

test('a port another service on the hub holds is refused, reaching no node', async () => {
  save({ password: '', nodes: [home], joins: [] })
  seen('home')
  writeFileSync(busyPort, '53\n')
  assert.equal(await changeHubPort(53), 'port-busy')
  assert.equal(existsSync(sshLog), false)
  assert.equal(existsSync(listenPort), false)
})

test('a node that cannot be reached unstages every node and leaves the hub\'s port alone', async () => {
  save({ password: '', nodes: [home], joins: [] })
  seen('home')
  writeFileSync(sshCode, '255')
  assert.deepEqual(await changeHubPort(443), [home])
  assert.ok(readFileSync(sshLog, 'utf8').endsWith(unstageScript))
  assert.equal(readFileSync(listenPort, 'utf8'), '51820\n')
})

test('a live join is found until it is dropped', () => {
  addNode('home')
  const [join] = load().joins
  assert.deepEqual(findJoin(join.token), join)
  dropJoin(join.token)
  assert.equal(findJoin(join.token), undefined)
  assert.deepEqual(load().joins, [])
})

test('an unknown or expired token finds nothing, and never writes data.json', () => {
  const joins = [{ token: 'old', n: 5, privateKey: 'key', expires: Date.now() - 1 }]
  save({ password: '', nodes: [], joins })
  const before = statSync(join(process.env.POSTERN_DIR!, 'data.json')).ino
  assert.equal(findJoin('old'), undefined)
  assert.equal(findJoin('missing'), undefined)
  assert.equal(statSync(join(process.env.POSTERN_DIR!, 'data.json')).ino, before)
})

test('dropping a join drops expired ones too', () => {
  const joins = [{ token: 'old', n: 5, privateKey: 'key', expires: Date.now() - 1 }, { token: 'used', n: 6, privateKey: 'key', expires: Date.now() + 60_000 }, { token: 'new', n: 7, privateKey: 'key', expires: Date.now() + 60_000 }]
  save({ password: '', nodes: [], joins })
  dropJoin('used')
  assert.deepEqual(load().joins.map((join) => join.token), ['new'])
})

test('adding a node keeps the rest of the data', () => {
  addNode('home')
  addNode('work')
  const data = load()
  assert.equal(data.password, 'salt:key')
  assert.deepEqual(data.nodes.map((node) => node.name), ['home', 'work'])
  assert.deepEqual(data.joins.map((join) => join.n), [2, 3])
})
