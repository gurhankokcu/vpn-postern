import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clear, expiredCookie, fail, hash, locked, sessionCookie, valid, verify } from './auth.ts'

const hour = 60 * 60 * 1000
const minute = 60 * 1000

function session() {
  return sessionCookie().split(';')[0]
}

test('hash is a hex salt and a hex key', () => {
  assert.match(hash('secret'), /^[0-9a-f]{32}:[0-9a-f]{128}$/)
})

test('hash salts every password afresh', () => {
  assert.notEqual(hash('secret'), hash('secret'))
})

test('verify accepts the right password', () => {
  assert.equal(verify('secret', hash('secret')), true)
})

test('verify rejects a wrong password', () => {
  assert.equal(verify('Secret', hash('secret')), false)
  assert.equal(verify('', hash('secret')), false)
})

test('verify accepts any password that was hashed, empty or not', () => {
  for (const password of ['', ' ', 'p:ss', 'pässwörd', 'x'.repeat(1000)]) {
    assert.equal(verify(password, hash(password)), true)
  }
})

test('verify rejects a malformed stored hash', () => {
  const [salt, key] = hash('secret').split(':')
  for (const stored of ['', ':', 'nocolon', `${salt}:`, `:${key}`, `${salt}:${key.slice(2)}`, 'zz:zz']) {
    assert.equal(verify('secret', stored), false)
  }
})

test('session cookie is HttpOnly, Secure, SameSite=Strict, for the whole site', () => {
  assert.match(sessionCookie(), /^session=\d+\.[0-9a-f]{64}; HttpOnly; Secure; SameSite=Strict; Path=\/$/)
})

test('valid accepts a fresh session', () => {
  assert.equal(valid(session()), true)
})

test('valid finds the session among other cookies', () => {
  assert.equal(valid(`theme=dark; ${session()}; lang=en`), true)
  assert.equal(valid(`theme=dark;${session()}`), true)
})

test('valid rejects a missing or empty session', () => {
  assert.equal(valid(), false)
  assert.equal(valid(''), false)
  assert.equal(valid('session='), false)
  assert.equal(valid('session=.'), false)
  assert.equal(valid('theme=dark'), false)
})

test('valid rejects a cookie that only ends in session', () => {
  assert.equal(valid(`x${session()}`), false)
})

test('valid rejects a tampered signature', () => {
  const cookie = session()
  const last = cookie.at(-1) === '0' ? '1' : '0'
  assert.equal(valid(cookie.slice(0, -1) + last), false)
  assert.equal(valid(cookie.slice(0, -1)), false)
})

test('valid rejects an extended expiry', () => {
  const [expiry, mac] = session().slice('session='.length).split('.')
  assert.equal(valid(`session=${Number(expiry) + hour}.${mac}`), false)
})

test('valid rejects a signature without an expiry', () => {
  const [, mac] = session().split('.')
  assert.equal(valid(`session=${mac}`), false)
})

test('a session lasts 12 hours', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
  const cookie = session()
  t.mock.timers.tick(12 * hour - 1)
  assert.equal(valid(cookie), true)
  t.mock.timers.tick(1)
  assert.equal(valid(cookie), false)
})

test('expired cookie clears the session', () => {
  const cookie = expiredCookie()
  assert.match(cookie, /^session=; Max-Age=0; HttpOnly; Secure; SameSite=Strict; Path=\/$/)
  assert.equal(valid(cookie.split(';')[0]), false)
})

test('an address is not locked before it fails', () => {
  assert.equal(locked('10.0.0.1'), false)
})

test('five fails lock an address, four do not', () => {
  const ip = '10.0.0.2'
  for (let i = 0; i < 4; i++) {
    fail(ip)
  }
  assert.equal(locked(ip), false)
  fail(ip)
  assert.equal(locked(ip), true)
})

test('a lock is per address', () => {
  for (let i = 0; i < 5; i++) {
    fail('10.0.0.3')
  }
  assert.equal(locked('10.0.0.4'), false)
})

test('clear unlocks an address and forgets its fails', () => {
  const ip = '10.0.0.5'
  for (let i = 0; i < 5; i++) {
    fail(ip)
  }
  clear(ip)
  assert.equal(locked(ip), false)
  for (let i = 0; i < 4; i++) {
    fail(ip)
  }
  assert.equal(locked(ip), false)
})

test('a lock lifts after 15 minutes', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
  const ip = '10.0.0.6'
  for (let i = 0; i < 5; i++) {
    fail(ip)
  }
  t.mock.timers.tick(15 * minute - 1)
  assert.equal(locked(ip), true)
  t.mock.timers.tick(1)
  assert.equal(locked(ip), false)
})

test('a lock lasts 15 minutes from the fifth fail, not the first', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
  const ip = '10.0.0.7'
  fail(ip)
  t.mock.timers.tick(10 * minute)
  for (let i = 0; i < 4; i++) {
    fail(ip)
  }
  t.mock.timers.tick(15 * minute - 1)
  assert.equal(locked(ip), true)
  t.mock.timers.tick(1)
  assert.equal(locked(ip), false)
})

test('fails older than 15 minutes are forgotten', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
  const ip = '10.0.0.8'
  for (let i = 0; i < 4; i++) {
    fail(ip)
  }
  t.mock.timers.tick(15 * minute)
  fail(ip)
  assert.equal(locked(ip), false)
})

test('after a lock lifts, one fail does not lock again', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
  const ip = '10.0.0.9'
  for (let i = 0; i < 5; i++) {
    fail(ip)
  }
  t.mock.timers.tick(15 * minute)
  fail(ip)
  assert.equal(locked(ip), false)
})
