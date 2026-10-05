import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const dir = join(mkdtempSync(join(tmpdir(), 'postern-')), 'nested', 'dir')
process.env.POSTERN_DIR = dir
const { address, live, load, port, save } = await import('./data.ts')
const file = join(dir, 'data.json')

test('the data directory is POSTERN_DIR, made on import', () => {
  assert.equal(existsSync(dir), true)
})

test('load with no file is no password, no nodes and no joins', () => {
  assert.deepEqual(load(), { password: '', nodes: [], joins: [] })
})

test('load returns what save saved', () => {
  const data = { password: 'salt:key', nodes: [{ name: 'home', n: 1, publicKey: 'key' }, { name: 'work', n: 2, publicKey: 'key' }], joins: [{ token: 'token', n: 2, privateKey: 'key', expires: 1 }] }
  save(data)
  assert.deepEqual(load(), data)
})

test('save leaves only data.json, readable by its owner alone', () => {
  save({ password: '', nodes: [], joins: [] })
  assert.deepEqual(readdirSync(dir), ['data.json'])
  assert.equal(statSync(file).mode & 0o777, 0o600)
})

test('save replaces what was there', () => {
  save({ password: 'a', nodes: [{ name: 'home', n: 1, publicKey: 'key' }], joins: [] })
  save({ password: 'b', nodes: [], joins: [] })
  assert.deepEqual(load(), { password: 'b', nodes: [], joins: [] })
})

test('load fills in what the file leaves out', () => {
  writeFileSync(file, JSON.stringify({ nodes: [{ name: 'home', n: 1, publicKey: 'key' }] }))
  assert.deepEqual(load(), { password: '', nodes: [{ name: 'home', n: 1, publicKey: 'key' }], joins: [] })
  writeFileSync(file, JSON.stringify({ password: 'salt:key' }))
  assert.deepEqual(load(), { password: 'salt:key', nodes: [], joins: [] })
})

test('a node n is at 10.99.0.n', () => {
  assert.equal(address({ n: 1 }), '10.99.0.1')
  assert.equal(address({ n: 254 }), '10.99.0.254')
})

test('a node n listens on 51820 + n', () => {
  assert.equal(port({ n: 1 }), 51821)
  assert.equal(port({ n: 254 }), 52074)
})

test('live keeps only joins that have not expired', () => {
  const fresh = { token: 'fresh', n: 2, privateKey: 'key', expires: Date.now() + 60_000 }
  const stale = { token: 'stale', n: 2, privateKey: 'key', expires: Date.now() - 1 }
  assert.deepEqual(live([stale, fresh]), [fresh])
})
