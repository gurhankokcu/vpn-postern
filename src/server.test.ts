import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, test } from 'node:test'

process.env.POSTERN_DIR = mkdtempSync(join(tmpdir(), 'postern-'))
const { clear, hash } = await import('./auth.ts')
const { save } = await import('./data.ts')
const { listener } = await import('./server.ts')

const password = 'correct-horse'
const nodes = [{ name: 'home', n: 1 }]
const server = createServer(listener)
let base = ''

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(() => {
  server.closeAllConnections()
  server.close()
})

beforeEach(() => {
  save({ password: hash(password), nodes })
  clear('127.0.0.1')
})

function request(path: string, init: RequestInit = {}) {
  return fetch(base + path, { redirect: 'manual', ...init })
}

function login(body: string) {
  return request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
}

async function session() {
  const res = await login(new URLSearchParams({ password }).toString())
  return res.headers.get('set-cookie')!.split(';')[0]
}

test('style.css is served to anyone', async () => {
  const res = await request('/style.css')
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'text/css; charset=utf-8')
  assert.equal(await res.text(), readFileSync(join(import.meta.dirname, 'style.css'), 'utf8'))
})

test('the login page is served to anyone', async () => {
  const res = await request('/login')
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8')
  assert.match(await res.text(), /action="\/login"/)
})

test('a query string does not change the route', async () => {
  const res = await request('/login?next=/')
  assert.equal(res.status, 200)
  assert.match(await res.text(), /action="\/login"/)
})

test('the right password signs in and goes home', async () => {
  const res = await login(`password=${password}`)
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), '/')
  assert.match(res.headers.get('set-cookie')!, /^session=\d+\.[0-9a-f]{64}; HttpOnly; Secure; SameSite=Strict; Path=\/$/)
})

test('a wrong password is refused', async () => {
  const res = await login('password=wrong-password')
  assert.equal(res.status, 401)
  assert.equal(res.headers.get('set-cookie'), null)
  assert.match(await res.text(), /Wrong password\./)
})

test('a login without a password is refused', async () => {
  assert.equal((await login('')).status, 401)
  assert.equal((await login('other=secret')).status, 401)
})

test('no password is right before one is set', async () => {
  save({ password: '', nodes })
  assert.equal((await login('password=')).status, 401)
  assert.equal((await login(`password=${password}`)).status, 401)
})

test('five wrong passwords lock the login, even for the right one', async () => {
  for (let i = 0; i < 5; i++) {
    assert.equal((await login('password=wrong-password')).status, 401)
  }
  const res = await login(`password=${password}`)
  assert.equal(res.status, 429)
  assert.equal(res.headers.get('set-cookie'), null)
  assert.match(await res.text(), /Too many attempts\. Try again later\./)
})

test('signing in forgets earlier wrong passwords', async () => {
  for (let i = 0; i < 4; i++) {
    await login('password=wrong-password')
  }
  assert.equal((await login(`password=${password}`)).status, 303)
  for (let i = 0; i < 4; i++) {
    assert.equal((await login('password=wrong-password')).status, 401)
  }
})

test('a body up to 4096 bytes is read', async () => {
  const res = await login(`password=${'x'.repeat(4096 - 'password='.length)}`)
  assert.equal(res.status, 401)
})

test('a body over 4096 bytes drops the connection', async (t) => {
  const error = t.mock.method(console, 'error', () => {})
  await assert.rejects(login(`password=${'x'.repeat(4097 - 'password='.length)}`))
  assert.equal(error.mock.callCount(), 1)
})

test('home lists the nodes to a signed-in admin', async () => {
  const res = await request('/', { headers: { cookie: await session() } })
  assert.equal(res.status, 200)
  assert.match(await res.text(), /<b>home<\/b>/)
})

test('home reads the nodes afresh on every request', async () => {
  const cookie = await session()
  save({ password: hash(password), nodes: [{ name: 'work', n: 2 }] })
  const html = await (await request('/', { headers: { cookie } })).text()
  assert.match(html, /<b>work<\/b>/)
  assert.doesNotMatch(html, /<b>home<\/b>/)
})

test('a password under 12 characters is refused', async () => {
  save({ password: hash('x'.repeat(11)), nodes })
  assert.equal((await login(`password=${'x'.repeat(11)}`)).status, 401)
})

test('a password over 256 characters is refused', async () => {
  save({ password: hash('x'.repeat(257)), nodes })
  assert.equal((await login(`password=${'x'.repeat(257)}`)).status, 401)
})

test('without a session every other page goes to login', async () => {
  for (const [method, path] of [['GET', '/'], ['GET', '/missing'], ['POST', '/logout'], ['POST', '/']]) {
    const res = await request(path, { method })
    assert.equal(res.status, 303)
    assert.equal(res.headers.get('location'), '/login')
    assert.equal(res.headers.get('set-cookie'), null)
  }
})

test('a forged session goes to login', async () => {
  const res = await request('/', { headers: { cookie: `session=${Date.now() + 60_000}.${'0'.repeat(64)}` } })
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), '/login')
})

test('logging out clears the session and goes to login', async () => {
  const res = await request('/logout', { method: 'POST', headers: { cookie: await session() } })
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), '/login')
  assert.match(res.headers.get('set-cookie')!, /^session=; Max-Age=0;/)
})

test('an unknown page is not found for a signed-in admin', async () => {
  const cookie = await session()
  for (const [method, path] of [['GET', '/missing'], ['GET', '/logout'], ['POST', '/']]) {
    const res = await request(path, { method, headers: { cookie } })
    assert.equal(res.status, 404)
    assert.match(await res.text(), /<h3>Not found<\/h3>/)
  }
})
