import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, test } from 'node:test'

process.env.POSTERN_DIR = mkdtempSync(join(tmpdir(), 'postern-'))
process.env.PATH = `${join(import.meta.dirname, '..', 'test', 'bin')}:${process.env.PATH}`
const { load, save } = await import('./data.ts')
const { addNode } = await import('./nodes.ts')
const log = join(process.env.POSTERN_DIR, 'wg.log')

beforeEach(() => {
  save({ password: 'salt:key', nodes: [] })
  rmSync(log, { force: true })
})

test('the first node is n 2, as the hub is 10.99.0.1', () => {
  addNode('home')
  assert.deepEqual(load().nodes.map((node) => node.n), [2])
})

test('a node takes the lowest free n', () => {
  save({ password: '', nodes: [{ name: 'a', n: 2, publicKey: 'key' }, { name: 'c', n: 4, publicKey: 'key' }] })
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
  save({ password: '', nodes })
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
  save({ password: '', nodes: Array.from({ length: 253 }, (_, i) => ({ name: `node${i + 2}`, n: i + 2, publicKey: 'key' })) })
  assert.equal(addNode('extra'), 'full')
  assert.equal(existsSync(log), false)
})

test('adding a node keeps the rest of the data', () => {
  addNode('home')
  addNode('work')
  const data = load()
  assert.equal(data.password, 'salt:key')
  assert.deepEqual(data.nodes.map((node) => node.name), ['home', 'work'])
})
