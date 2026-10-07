import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, test } from 'node:test'

process.env.POSTERN_DIR = mkdtempSync(join(tmpdir(), 'postern-'))
process.env.PATH = `${join(import.meta.dirname, '..', 'dev', 'bin')}:${process.env.PATH}`
const { handshakes, hubPort } = await import('./wg.ts')
const file = join(process.env.POSTERN_DIR, 'handshakes')

beforeEach(() => {
  rmSync(file, { force: true })
})

test('handshakes maps each peer key to its last handshake in ms', () => {
  writeFileSync(file, 'keyA=\t1700000000\nkeyB=\t0\n')
  assert.deepEqual(handshakes(), new Map([['keyA=', 1_700_000_000_000], ['keyB=', 0]]))
})

test('handshakes is empty with no peers', () => {
  assert.deepEqual(handshakes(), new Map())
})

test('hubPort is the port postern0 listens on', () => {
  assert.equal(hubPort(), 51820)
  writeFileSync(join(process.env.POSTERN_DIR!, 'listen-port'), '443\n')
  assert.equal(hubPort(), 443)
})
