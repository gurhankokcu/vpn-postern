import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const dir = join(mkdtempSync(join(tmpdir(), 'postern-')), 'nested', 'dir')
process.env.POSTERN_DIR = dir
const { address, load, port, save } = await import('./data.ts')
const file = join(dir, 'data.json')

test('the data directory is POSTERN_DIR, made on import', () => {
  assert.equal(existsSync(dir), true)
})

test('load with no file is no password and no nodes', () => {
  assert.deepEqual(load(), { password: '', nodes: [] })
})

test('load returns what save saved', () => {
  const data = { password: 'salt:key', nodes: [{ name: 'home', n: 1 }, { name: 'work', n: 2 }] }
  save(data)
  assert.deepEqual(load(), data)
})

test('save leaves only data.json, readable by its owner alone', () => {
  save({ password: '', nodes: [] })
  assert.deepEqual(readdirSync(dir), ['data.json'])
  assert.equal(statSync(file).mode & 0o777, 0o600)
})

test('save replaces what was there', () => {
  save({ password: 'a', nodes: [{ name: 'home', n: 1 }] })
  save({ password: 'b', nodes: [] })
  assert.deepEqual(load(), { password: 'b', nodes: [] })
})

test('load fills in what the file leaves out', () => {
  writeFileSync(file, JSON.stringify({ nodes: [{ name: 'home', n: 1 }] }))
  assert.deepEqual(load(), { password: '', nodes: [{ name: 'home', n: 1 }] })
  writeFileSync(file, JSON.stringify({ password: 'salt:key' }))
  assert.deepEqual(load(), { password: 'salt:key', nodes: [] })
})

test('a node n is at 10.99.0.n', () => {
  assert.equal(address({ name: 'home', n: 1 }), '10.99.0.1')
  assert.equal(address({ name: 'home', n: 254 }), '10.99.0.254')
})

test('a node n listens on 51820 + n', () => {
  assert.equal(port({ name: 'home', n: 1 }), 51821)
  assert.equal(port({ name: 'home', n: 254 }), 52074)
})
