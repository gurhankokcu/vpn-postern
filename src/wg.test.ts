import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, test } from 'node:test'

process.env.POSTERN_DIR = mkdtempSync(join(tmpdir(), 'postern-'))
process.env.PATH = `${join(import.meta.dirname, '..', 'dev', 'bin')}:${process.env.PATH}`
const { handshakes, hubPort, hubPortFree, recent, setHubPort } = await import('./wg.ts')
const file = join(process.env.POSTERN_DIR, 'handshakes')
const dir = process.env.POSTERN_DIR

beforeEach(() => {
  rmSync(file, { force: true })
  for (const name of ['listen-port', 'busy-port', 'wg.log']) {
    rmSync(join(dir, name), { force: true })
  }
})

test('handshakes maps each peer key to its last handshake in ms', () => {
  writeFileSync(file, 'keyA=\t1700000000\nkeyB=\t0\n')
  assert.deepEqual(handshakes(), new Map([['keyA=', 1_700_000_000_000], ['keyB=', 0]]))
})

test('handshakes is empty with no peers', () => {
  assert.deepEqual(handshakes(), new Map())
})

test('a handshake is recent within the last 3 minutes, and no handshake is not', () => {
  assert.equal(recent(Date.now() - 170_000), true)
  assert.equal(recent(Date.now() - 190_000), false)
  assert.equal(recent(), false)
})

test('hubPort is the port postern0 listens on', () => {
  assert.equal(hubPort(), 51820)
  writeFileSync(join(process.env.POSTERN_DIR!, 'listen-port'), '443\n')
  assert.equal(hubPort(), 443)
})

test('a free port is taken for a moment and given back', () => {
  assert.equal(hubPortFree(53), true)
  assert.equal(readFileSync(join(dir, 'wg.log'), 'utf8'), 'wg show postern0 listen-port\nwg set postern0 listen-port 53\nwg set postern0 listen-port 51820\n')
  assert.equal(hubPort(), 51820)
})

test('a port another service holds is not free, and the hub keeps its own', () => {
  writeFileSync(join(dir, 'busy-port'), '53\n')
  assert.equal(hubPortFree(53), false)
  assert.equal(hubPort(), 51820)
})

test('setHubPort moves postern0 live and saves it', () => {
  setHubPort(443)
  assert.equal(hubPort(), 443)
  assert.match(readFileSync(join(dir, 'wg.log'), 'utf8'), /^wg set postern0 listen-port 443\nwg-quick save postern0\n/)
})
