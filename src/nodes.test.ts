import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, test } from 'node:test'

process.env.POSTERN_DIR = mkdtempSync(join(tmpdir(), 'postern-'))
const { load, save } = await import('./data.ts')
const { addNode } = await import('./nodes.ts')

beforeEach(() => {
  save({ password: 'salt:key', nodes: [] })
})

test('the first node is n 2, as the hub is 10.99.0.1', () => {
  addNode('home')
  assert.deepEqual(load().nodes.map((node) => node.n), [2])
})

test('a node takes the lowest free n', () => {
  save({ password: '', nodes: [{ name: 'a', n: 2 }, { name: 'c', n: 4 }] })
  addNode('b')
  addNode('d')
  assert.deepEqual(load().nodes.map((node) => [node.name, node.n]), [['a', 2], ['c', 4], ['b', 3], ['d', 5]])
})

test('a name already in use, in any case, is refused', () => {
  assert.equal(addNode('Home Pi'), 'added')
  assert.equal(addNode('Home Pi'), 'taken')
  assert.equal(addNode('home pi'), 'taken')
  assert.equal(addNode('HOME PI'), 'taken')
  assert.deepEqual(load().nodes, [{ name: 'Home Pi', n: 2 }])
})

test('254 is the last n', () => {
  const nodes = Array.from({ length: 252 }, (_, i) => ({ name: `node${i + 2}`, n: i + 2 }))
  save({ password: '', nodes })
  assert.equal(addNode('last'), 'added')
  assert.deepEqual(load().nodes.at(-1), { name: 'last', n: 254 })
  assert.equal(addNode('extra'), 'full')
  assert.equal(load().nodes.length, 253)
})

test('adding a node keeps the rest of the data', () => {
  addNode('home')
  addNode('work')
  const data = load()
  assert.equal(data.password, 'salt:key')
  assert.deepEqual(data.nodes.map((node) => node.name), ['home', 'work'])
})
