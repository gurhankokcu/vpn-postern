import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, test } from 'node:test'

const dir = mkdtempSync(join(tmpdir(), 'postern-'))
process.env.POSTERN_DIR = dir
process.env.PATH = `${join(import.meta.dirname, '..', 'dev', 'bin')}:${process.env.PATH}`
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=test', '-keyout', join(dir, 'tls.key'), '-out', join(dir, 'tls.crt')], { stdio: 'ignore' })
writeFileSync(join(dir, 'id_ed25519.pub'), 'ssh-ed25519 AAAAhub postern\n')
const { clear, hash } = await import('./auth.ts')
const { load, save } = await import('./data.ts')
const { listener } = await import('./server.ts')

const password = 'correct-horse'
const nodes = [{ name: 'home', n: 1, publicKey: 'key' }]
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
  save({ password: hash(password), nodes, joins: [] })
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
  save({ password: '', nodes, joins: [] })
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
  save({ password: hash(password), nodes: [{ name: 'work', n: 2, publicKey: 'key' }], joins: [] })
  const html = await (await request('/', { headers: { cookie } })).text()
  assert.match(html, /<b>work<\/b>/)
  assert.doesNotMatch(html, /<b>home<\/b>/)
})

test('home shows a node online from its latest handshake', async () => {
  writeFileSync(join(dir, 'handshakes'), `key\t${Math.floor(Date.now() / 1000)}\n`)
  const html = await (await request('/', { headers: { cookie: await session() } })).text()
  rmSync(join(dir, 'handshakes'))
  assert.match(html, /<b>home<\/b><\/td>\n<td><span class="pill online">online<\/span>/)
})

test('home shows the pinned join command with the host it was reached at', async () => {
  save({ password: hash(password), nodes, joins: [{ token: 'abc', n: 1, privateKey: 'key', expires: Date.now() + 60_000 }] })
  const html = await (await request('/', { headers: { cookie: await session() } })).text()
  const pin = execFileSync('sh', ['-c', `openssl x509 -in ${join(dir, 'tls.crt')} -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`], { encoding: 'utf8' }).trim()
  assert.ok(html.includes(`curl -fsSk --pinnedpubkey sha256//${pin} https://${new URL(base).host}/join/abc | sudo sh`))
})

test('a join command needs no session and gets the script once', async () => {
  save({ password: hash(password), nodes, joins: [{ token: 'abc', n: 2, privateKey: 'nodeprivate', expires: Date.now() + 60_000 }] })
  const res = await request('/join/abc')
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8')
  const script = await res.text()
  assert.match(script, /^Address = 10\.99\.0\.2\/32\nPrivateKey = nodeprivate$/m)
  assert.match(script, /^PublicKey = hubpublic\nEndpoint = 127\.0\.0\.1:51820$/m)
  assert.match(script, /^    echo 'ssh-ed25519 AAAAhub postern' >> \/root\/\.ssh\/authorized_keys$/m)
  assert.equal((await request('/join/abc')).status, 404)
  assert.deepEqual(load().joins, [])
})

test('an unknown join command runs no wg', async () => {
  rmSync(join(dir, 'wg.log'), { force: true })
  assert.equal((await request('/join/missing')).status, 404)
  assert.equal(existsSync(join(dir, 'wg.log')), false)
})

test('an unknown or expired join command is not found, with no login redirect', async () => {
  save({ password: hash(password), nodes, joins: [{ token: 'old', n: 2, privateKey: 'key', expires: Date.now() - 1 }] })
  for (const path of ['/join/old', '/join/missing', '/join/']) {
    const res = await request(path)
    assert.equal(res.status, 404)
    assert.equal(await res.text(), 'This join command is used or expired.\n')
  }
})

function add(cookie: string, body: string) {
  return request('/nodes', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
}

test('adding a node saves it and goes home', async () => {
  const res = await add(await session(), 'nodeName=Mum%20and%20Dad%20Pi')
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), '/')
  assert.deepEqual(load().nodes.map((node) => [node.name, node.n]), [['home', 1], ['Mum and Dad Pi', 2]])
  assert.deepEqual(load().joins.map((join) => join.n), [2])
})

test('a node name against the rule is refused with a note, adding nothing', async () => {
  const cookie = await session()
  for (const body of ['', 'nodeName=', 'nodeName=%20work%20', `nodeName=${encodeURIComponent("Mum & Dad's <Pi>")}`]) {
    const res = await add(cookie, body)
    assert.equal(res.status, 400)
    assert.match(await res.text(), /<div class="note">A node name is 1 to 32 letters, digits, - or _, with single spaces between words\.<\/div>/)
  }
  assert.deepEqual(load().nodes, nodes)
})

test('a refused node name stays in the form, escaped', async () => {
  const res = await add(await session(), `nodeName=${encodeURIComponent("Mum & Dad's <Pi>")}`)
  assert.match(await res.text(), /<input name="nodeName" value="Mum &#38; Dad&#39;s &#60;Pi&#62;"/)
})

test('a node name already in use, in any case, is refused with a note, adding nothing', async () => {
  const res = await add(await session(), 'nodeName=HOME')
  assert.equal(res.status, 409)
  const html = await res.text()
  assert.match(html, /<div class="note">Another node already has that name\.<\/div>/)
  assert.match(html, /<input name="nodeName" value="HOME"/)
  assert.deepEqual(load().nodes, nodes)
})

test('a node beyond the last address is refused with a note, adding nothing', async () => {
  const full = Array.from({ length: 253 }, (_, i) => ({ name: `node${i + 2}`, n: i + 2, publicKey: 'key' }))
  save({ password: hash(password), nodes: full, joins: [] })
  const res = await add(await session(), 'nodeName=extra')
  assert.equal(res.status, 409)
  const html = await res.text()
  assert.match(html, /<div class="note">All 253 node addresses are in use\.<\/div>/)
  assert.match(html, /<input name="nodeName" value="extra"/)
  assert.deepEqual(load().nodes, full)
})

test('removing a node drops it and goes home', async () => {
  const res = await request('/nodes/1/remove', { method: 'POST', headers: { cookie: await session() } })
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), '/')
  assert.deepEqual(load().nodes, [])
})

test('removing an unknown node is not found, changing nothing', async () => {
  const cookie = await session()
  for (const path of ['/nodes/9/remove', '/nodes/x/remove', '/nodes//remove']) {
    const res = await request(path, { method: 'POST', headers: { cookie } })
    assert.equal(res.status, 404)
    assert.match(await res.text(), /<h3>Not found<\/h3>/)
  }
  assert.deepEqual(load().nodes, nodes)
})

test('a password under 12 characters is refused', async () => {
  save({ password: hash('x'.repeat(11)), nodes, joins: [] })
  assert.equal((await login(`password=${'x'.repeat(11)}`)).status, 401)
})

test('a password over 256 characters is refused', async () => {
  save({ password: hash('x'.repeat(257)), nodes, joins: [] })
  assert.equal((await login(`password=${'x'.repeat(257)}`)).status, 401)
})

test('without a session every other page goes to login', async () => {
  for (const [method, path] of [['GET', '/'], ['GET', '/missing'], ['POST', '/logout'], ['POST', '/'], ['POST', '/nodes'], ['POST', '/nodes/1/remove']]) {
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
