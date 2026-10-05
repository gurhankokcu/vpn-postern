import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, test } from 'node:test'

process.env.POSTERN_DIR = mkdtempSync(join(tmpdir(), 'postern-'))
process.env.PATH = `${join(import.meta.dirname, '..', 'dev', 'bin')}:${process.env.PATH}`
const { load, save } = await import('./data.ts')
const { addNode, dropJoin, findJoin, removeNode } = await import('./nodes.ts')
const log = join(process.env.POSTERN_DIR, 'wg.log')

beforeEach(() => {
  save({ password: 'salt:key', nodes: [], joins: [] })
  rmSync(log, { force: true })
})

test('the first node is n 2, as the hub is 10.99.0.1', () => {
  addNode('home')
  assert.deepEqual(load().nodes.map((node) => node.n), [2])
})

test('a node takes the lowest free n', () => {
  save({ password: '', nodes: [{ name: 'a', n: 2, publicKey: 'key' }, { name: 'c', n: 4, publicKey: 'key' }], joins: [] })
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
  const nodes = Array.from({ length: 252 }, (_, i) => ({ name: `node${i + 2}`, n: i + 2, publicKey: 'key' }))
  save({ password: '', nodes, joins: [] })
  assert.equal(addNode('last'), 'added')
  assert.deepEqual(load().nodes.at(-1), { name: 'last', n: 254, publicKey: 'public1' })
  assert.equal(addNode('extra'), 'full')
  assert.equal(load().nodes.length, 253)
})

test('a node keeps the public key of a fresh keypair', () => {
  addNode('home')
  assert.deepEqual(load().nodes, [{ name: 'home', n: 2, publicKey: 'public1' }])
})

test('the peer joins postern0 live and is saved to its conf', () => {
  addNode('home')
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), [
    'wg genkey',
    'wg pubkey',
    'wg set postern0 peer public1 allowed-ips 10.99.0.2/32',
    'wg-quick save postern0',
  ])
})

test('a refused node makes no keys and no peer', () => {
  addNode('home')
  rmSync(log)
  assert.equal(addNode('HOME'), 'taken')
  save({ password: '', nodes: Array.from({ length: 253 }, (_, i) => ({ name: `node${i + 2}`, n: i + 2, publicKey: 'key' })), joins: [] })
  assert.equal(addNode('extra'), 'full')
  assert.equal(existsSync(log), false)
})

test('the node keeps its public key, its join the private one', () => {
  addNode('home')
  const { nodes, joins } = load()
  assert.deepEqual(nodes, [{ name: 'home', n: 2, publicKey: 'public1' }])
  assert.deepEqual(joins.map((join) => [join.n, join.privateKey]), [[2, 'private1']])
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
  const nodes = [{ name: 'old', n: 5, publicKey: 'key' }, { name: 'new', n: 6, publicKey: 'key' }]
  const joins = [{ token: 'old', n: 5, privateKey: 'key', expires: Date.now() - 1 }, { token: 'new', n: 6, privateKey: 'key', expires: Date.now() + 60_000 }]
  save({ password: '', nodes, joins })
  addNode('home')
  assert.deepEqual(load().joins.map((join) => join.n), [6, 2])
})

test('removing a node takes its peer off postern0, live and in its conf', () => {
  addNode('home')
  assert.equal(removeNode(2), 'removed')
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n').slice(4), [
    'wg set postern0 peer public1 remove',
    'wg-quick save postern0',
  ])
})

test('removing a node drops it and its join, keeps the rest, and drops expired joins', () => {
  const nodes = [{ name: 'home', n: 2, publicKey: 'home' }, { name: 'work', n: 3, publicKey: 'work' }]
  const joins = [{ token: 'home', n: 2, privateKey: 'key', expires: Date.now() + 60_000 }, { token: 'work', n: 3, privateKey: 'key', expires: Date.now() + 60_000 }, { token: 'old', n: 4, privateKey: 'key', expires: Date.now() - 1 }]
  save({ password: 'salt:key', nodes, joins })
  removeNode(2)
  assert.deepEqual(load(), { password: 'salt:key', nodes: [nodes[1]], joins: [joins[1]] })
})

test('a removed node frees its n and its name', () => {
  addNode('home')
  addNode('work')
  removeNode(2)
  assert.equal(addNode('home'), 'added')
  assert.deepEqual(load().nodes.map((node) => [node.name, node.n]), [['work', 3], ['home', 2]])
})

test('removing an unknown node runs no wg and changes nothing', () => {
  addNode('home')
  rmSync(log)
  const before = load()
  assert.equal(removeNode(3), 'missing')
  assert.equal(existsSync(log), false)
  assert.deepEqual(load(), before)
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
