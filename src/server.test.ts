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
const nodes = [{ name: 'home', n: 1, port: 51821, publicKey: 'key' }]
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
  for (const file of ['handshakes', 'listen-port', 'busy-port', 'ssh.log', 'ssh.out', 'ssh.code', 'ssh.hang']) {
    rmSync(join(dir, file), { force: true })
  }
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

test('script.js is served to anyone', async () => {
  const res = await request('/script.js')
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'text/javascript; charset=utf-8')
  assert.equal(await res.text(), readFileSync(join(import.meta.dirname, 'script.js'), 'utf8'))
})

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

test('the right password logs in and goes home', async () => {
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

test('logging in forgets earlier wrong passwords', async () => {
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

test('a join command needs no session and gets the script once', async () => {
  save({ password: hash(password), nodes: [...nodes, { name: 'work', n: 2, port: 443, publicKey: 'key' }], joins: [{ token: 'abc', n: 2, privateKey: 'nodeprivate', expires: Date.now() + 60_000 }] })
  const res = await request('/join/abc')
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8')
  const script = await res.text()
  assert.match(script, /^Address = 10\.99\.0\.2\/32\nPrivateKey = nodeprivate$/m)
  assert.match(script, /^PublicKey = hubpublic\nEndpoint = 127\.0\.0\.1:51820$/m)
  assert.match(script, /^    echo 'ssh-ed25519 AAAAhub postern' >> \/root\/\.ssh\/authorized_keys$/m)
  assert.match(script, /\/s\/:\[0-9\]\*\$\/:443\/' "\$client"$/m)
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

function online() {
  writeFileSync(join(dir, 'handshakes'), `key\t${Math.floor(Date.now() / 1000)}\n`)
}

async function page(path: string) {
  return (await request(path, { headers: { cookie: await session() } })).text()
}

test('the tree lists the nodes to a logged-in admin', async () => {
  const res = await request('/', { headers: { cookie: await session() } })
  assert.equal(res.status, 200)
  assert.match(await res.text(), /<b>home<\/b>/)
})

test('the tree reads the nodes afresh on every request', async () => {
  const cookie = await session()
  save({ password: hash(password), nodes: [{ name: 'work', n: 2, port: 51822, publicKey: 'key' }], joins: [] })
  const html = await (await request('/', { headers: { cookie } })).text()
  assert.match(html, /<b>work<\/b>/)
  assert.doesNotMatch(html, /<b>home<\/b>/)
})

test('the tree shows the port postern0 listens on as the hub\'s', async () => {
  writeFileSync(join(dir, 'listen-port'), '443\n')
  assert.match(await page('/'), /<td class="mono address">10\.99\.0\.1<\/td>\n<td class="mono port"><span class="value">443<a /)
})

test('an offline node is not asked for its devices', async () => {
  answer(wg0)
  const html = await page('/')
  assert.match(html, /<i class="dot offline" role="img" aria-label="offline"><\/i><b>home<\/b>/)
  assert.match(html, /Offline\. Its devices show here once it is back\./)
  assert.equal(existsSync(join(dir, 'ssh.log')), false)
})

test('an online node is asked for its devices, waiting 3 seconds at most', async () => {
  online()
  answer(wg0)
  const html = await page('/')
  assert.match(html, /<i class="dot online" role="img" aria-label="online"><\/i><b>home<\/b>/)
  assert.match(html, /<b>mum<\/b><\/span><\/div><\/td>\n<td class="mono address">10\.66\.66\.2<\/td>/)
  assert.match(readFileSync(join(dir, 'ssh.log'), 'utf8'), /-o ConnectTimeout=3 root@10\.99\.0\.1 cat \/etc\/wireguard\/wg0\.conf/)
})

test('an online node that cannot be reached shows as offline', async () => {
  online()
  answer('', 255)
  const html = await page('/')
  assert.match(html, /<i class="dot offline" role="img" aria-label="offline"><\/i><b>home<\/b>/)
  assert.match(html, /Offline\. Its devices show here once it is back\./)
})

test('online nodes that stop answering are asked all at once, and the tree shows them offline after 3 seconds', async () => {
  const cookie = await session()
  save({ password: hash(password), nodes: [{ name: 'home', n: 2, port: 51822, publicKey: 'home' }, { name: 'work', n: 3, port: 51823, publicKey: 'work' }], joins: [] })
  const now = Math.floor(Date.now() / 1000)
  writeFileSync(join(dir, 'handshakes'), `home\t${now}\nwork\t${now}\n`)
  writeFileSync(join(dir, 'ssh.hang'), '')
  const start = Date.now()
  const html = await (await request('/', { headers: { cookie } })).text()
  assert.ok(Date.now() - start < 5000)
  assert.match(html, /<i class="dot offline" role="img" aria-label="offline"><\/i><b>home<\/b>/)
  assert.match(html, /<i class="dot offline" role="img" aria-label="offline"><\/i><b>work<\/b>/)
})

function add(cookie: string, body: string) {
  return request('/nodes', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
}

test('add node opens over the tree with the next free port filled in', async () => {
  const html = await page('/nodes/new')
  assert.match(html, /<b>home<\/b>/)
  assert.match(html, /<dialog open aria-labelledby="modal-title">\n<div class="card-head"><h2 id="modal-title">Add node<\/h2>/)
  assert.match(html, /<input name="port" value="51822"/)
})

test('adding a node saves it with its port and opens its join command', async () => {
  const res = await add(await session(), 'nodeName=Mum%20and%20Dad%20Pi&port=443')
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), '/nodes/2/join')
  assert.deepEqual(load().nodes.map((node) => [node.name, node.n, node.port]), [['home', 1, 51821], ['Mum and Dad Pi', 2, 443]])
  assert.deepEqual(load().joins.map((join) => join.n), [2])
})

test('a node name against the rule is refused with a note, adding nothing', async () => {
  const cookie = await session()
  for (const body of ['port=443', 'nodeName=&port=443', 'nodeName=%20work%20&port=443', `nodeName=${encodeURIComponent("Mum & Dad's <Pi>")}&port=443`]) {
    const res = await add(cookie, body)
    assert.equal(res.status, 400)
    assert.match(await res.text(), /<div class="note">A node name is 1 to 32 letters, digits, - or _, with single spaces between words\.<\/div>/)
  }
  assert.deepEqual(load().nodes, nodes)
})

test('a refused node keeps what was typed in its form, escaped', async () => {
  const html = await (await add(await session(), `nodeName=${encodeURIComponent("Mum & Dad's <Pi>")}&port=4%2243`)).text()
  assert.match(html, /<input name="nodeName" value="Mum &#38; Dad&#39;s &#60;Pi&#62;"/)
  assert.match(html, /<input name="port" value="4&#34;43"/)
})

test('a port against the rule is refused with a note, adding nothing', async () => {
  const cookie = await session()
  for (const body of ['nodeName=work', 'nodeName=work&port=', 'nodeName=work&port=0', 'nodeName=work&port=65536', 'nodeName=work&port=4.4', 'nodeName=work&port=x']) {
    const res = await add(cookie, body)
    assert.equal(res.status, 400, body)
    assert.match(await res.text(), /<div class="note">A port is a whole number from 1 to 65535\.<\/div>/)
  }
  assert.deepEqual(load().nodes, nodes)
})

test('a port the hub or another node uses is refused with a note', async () => {
  const cookie = await session()
  for (const port of [51820, 51821]) {
    const res = await add(cookie, `nodeName=work&port=${port}`)
    assert.equal(res.status, 409)
    assert.match(await res.text(), /<div class="note">The hub or another node already uses that port\.<\/div>/)
  }
  assert.deepEqual(load().nodes, nodes)
})

test('a node name already in use, in any case, is refused with a note, adding nothing', async () => {
  const res = await add(await session(), 'nodeName=HOME&port=443')
  assert.equal(res.status, 409)
  const html = await res.text()
  assert.match(html, /<div class="note">Another node already has that name\.<\/div>/)
  assert.match(html, /<input name="nodeName" value="HOME"/)
  assert.deepEqual(load().nodes, nodes)
})

test('a node beyond the last address is refused with a note, adding nothing', async () => {
  const full = Array.from({ length: 253 }, (_, i) => ({ name: `node${i + 2}`, n: i + 2, port: 51822 + i, publicKey: 'key' }))
  save({ password: hash(password), nodes: full, joins: [] })
  const res = await add(await session(), 'nodeName=extra&port=443')
  assert.equal(res.status, 409)
  assert.match(await res.text(), /<div class="note">All 253 node addresses are in use\.<\/div>/)
  assert.deepEqual(load().nodes, full)
})

test('the join command opens over the tree, pinned, with the host it was reached at', async () => {
  save({ password: hash(password), nodes, joins: [{ token: 'abc', n: 1, privateKey: 'key', expires: Date.now() + 60_000 }] })
  const html = await page('/nodes/1/join')
  const pin = execFileSync('sh', ['-c', `openssl x509 -in ${join(dir, 'tls.crt')} -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`], { encoding: 'utf8' }).trim()
  assert.match(html, /<h2 id="modal-title">Join home<\/h2>/)
  assert.ok(html.includes(`<pre tabindex="0">curl -fsSk --pinnedpubkey sha256//${pin} https://${new URL(base).host}/join/abc | sudo sh</pre>`))
  assert.match(html, /Expires in 1 minute\./)
})

test('a node with no live join has no join command', async () => {
  save({ password: hash(password), nodes, joins: [{ token: 'abc', n: 1, privateKey: 'key', expires: Date.now() - 1 }] })
  const cookie = await session()
  for (const path of ['/nodes/1/join', '/nodes/9/join']) {
    assert.equal((await request(path, { headers: { cookie } })).status, 404)
  }
})

test('removing a node drops it and goes back to the tree', async () => {
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

const wg0 = `[Interface]
ListenPort = 51821
PrivateKey = privateserver

### Client mum
[Peer]
PublicKey = mumpublic
AllowedIPs = 10.66.66.2/32
`

function answer(stdout: string, code = 0) {
  rmSync(join(dir, 'ssh.log'), { force: true })
  writeFileSync(join(dir, 'ssh.out'), stdout)
  writeFileSync(join(dir, 'ssh.code'), String(code))
}

function addDevice(cookie: string, body: string) {
  return request('/nodes/1/devices', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
}

test('add device opens over the tree for its node', async () => {
  const html = await page('/nodes/1/new-device')
  assert.match(html, /<h2 id="modal-title">Add a device to home<\/h2>/)
  assert.match(html, /<form class="form" method="post" action="\/nodes\/1\/devices">/)
  assert.equal((await request('/nodes/9/new-device', { headers: { cookie: await session() } })).status, 404)
})

test('adding a device writes it to the node, dialing its port, and shows its QR code', async () => {
  save({ password: hash(password), nodes: [{ ...nodes[0], port: 443 }], joins: [] })
  answer(wg0)
  const res = await addDevice(await session(), 'deviceName=tablet')
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), '/nodes/1/devices/tablet')
  const log = readFileSync(join(dir, 'ssh.log'), 'utf8')
  assert.match(log, /^### Client tablet\n\[Peer\]\nPublicKey = public\d+\nAllowedIPs = 10\.66\.66\.3\/32$/m)
  assert.match(log, /^Endpoint = 127\.0\.0\.1:443$/m)
})

test('a device name against the rule is refused with a note, reaching no node', async () => {
  const cookie = await session()
  for (const body of ['', 'deviceName=', 'deviceName=mum%20phone', 'deviceName=..%2Fmum']) {
    answer(wg0)
    const res = await addDevice(cookie, body)
    assert.equal(res.status, 400)
    assert.match(await res.text(), /<div class="note">A device name is 1 to 32 letters, digits, - or _\.<\/div>/)
    assert.equal(existsSync(join(dir, 'ssh.log')), false)
  }
})

test('a device name already on the node, in any case, is refused with a note', async () => {
  answer(wg0)
  const res = await addDevice(await session(), 'deviceName=MUM')
  assert.equal(res.status, 409)
  const html = await res.text()
  assert.match(html, /<div class="note">Another device on this node already has that name\.<\/div>/)
  assert.match(html, /<input name="deviceName" value="MUM"/)
})

test('a device beyond the last address is refused with a note', async () => {
  answer(`${wg0}${Array.from({ length: 253 }, (_, i) => `\n[Peer]\nAllowedIPs = 10.66.66.${i + 2}/32\n`).join('')}`)
  const res = await addDevice(await session(), 'deviceName=tablet')
  assert.equal(res.status, 409)
  assert.match(await res.text(), /<div class="note">All 253 device addresses on this node are in use\.<\/div>/)
})

test('adding a device to an offline node says so in its form, trying it only once', async () => {
  answer('', 255)
  const res = await addDevice(await session(), 'deviceName=tablet')
  assert.equal(res.status, 503)
  const html = await res.text()
  assert.match(html, /<div class="note">home is offline\.<\/div>/)
  assert.match(html, /<input name="deviceName" value="tablet"/)
  assert.equal(readFileSync(join(dir, 'ssh.log'), 'utf8').match(/^ssh /gm)?.length, 1)
})

test('a device opens over the tree with its QR code and config', async () => {
  answer('CLIENT\n')
  const html = await page('/nodes/1/devices/mum')
  assert.match(html, /<h2 id="modal-title">mum <span class="pill">home<\/span><\/h2>/)
  assert.match(html, /<div class="qr"><svg>qr<\/svg>\n<\/div>/)
  assert.match(html, /<pre tabindex="0">CLIENT\n<\/pre>/)
  assert.match(html, /href="\/nodes\/1\/devices\/mum\.conf" aria-label="Download \.conf" download/)
})

test('a device\'s .conf downloads as a file', async () => {
  answer('CLIENT\n')
  const res = await request('/nodes/1/devices/mum.conf', { headers: { cookie: await session() } })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="mum.conf"')
  assert.equal(await res.text(), 'CLIENT\n')
})

test('a device on an offline node says so, and its .conf is unavailable', async () => {
  answer('', 255)
  const cookie = await session()
  assert.match(await (await request('/nodes/1/devices/mum', { headers: { cookie } })).text(), /home is offline\. Its QR code shows here once it is back\./)
  const res = await request('/nodes/1/devices/mum.conf', { headers: { cookie } })
  assert.equal(res.status, 503)
  assert.equal(await res.text(), 'home is offline.\n')
})

test('an unknown device or node is not found', async () => {
  answer('', 1)
  const cookie = await session()
  for (const path of ['/nodes/1/devices/missing', '/nodes/1/devices/missing.conf', '/nodes/9', '/nodes/1', '/nodes/9/devices/mum', '/nodes/1/devices/mum%20phone', '/nodes/1/devices/', '/nodes/x']) {
    const res = await request(path, { headers: { cookie } })
    assert.equal(res.status, 404, path)
    assert.match(await res.text(), /<h3>Not found<\/h3>/)
  }
  assert.equal((await request('/nodes/9/devices', { method: 'POST', headers: { cookie } })).status, 404)
})

function removeDevice(cookie: string, name: string) {
  return request(`/nodes/1/devices/${name}/remove`, { method: 'POST', headers: { cookie } })
}

test('removing a device drops it from the node and goes back to the tree', async () => {
  answer(wg0)
  const res = await removeDevice(await session(), 'mum')
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), '/')
  const log = readFileSync(join(dir, 'ssh.log'), 'utf8')
  assert.doesNotMatch(log.split(/ sh\n/)[1], /### Client mum/)
  assert.match(log, /^rm -f \/etc\/wireguard\/clients\/mum\.conf$/m)
})

test('removing a device from an offline node says the node is offline, trying it only once', async () => {
  answer('', 255)
  const res = await removeDevice(await session(), 'mum')
  assert.equal(res.status, 503)
  assert.match(await res.text(), /<main><div class="note">home is offline\.<\/div>/)
  assert.equal(readFileSync(join(dir, 'ssh.log'), 'utf8').match(/^ssh /gm)?.length, 1)
})

test('removing an unknown device, or one on an unknown node, is not found', async () => {
  answer(wg0)
  const cookie = await session()
  for (const path of ['/nodes/1/devices/tablet/remove', '/nodes/9/devices/mum/remove', '/nodes/1/devices/mum%20phone/remove', '/nodes/1/devices//remove']) {
    const res = await request(path, { method: 'POST', headers: { cookie } })
    assert.equal(res.status, 404, path)
    assert.match(await res.text(), /<h3>Not found<\/h3>/)
  }
})

function changePort(cookie: string, body: string, n = 1) {
  return request(`/nodes/${n}/port`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
}

test('a node\'s port opens over the tree, prefilled, reminding of its devices', async () => {
  answer(wg0)
  const html = await page('/nodes/1/port')
  assert.match(html, /<h2 id="modal-title">home's port<\/h2>/)
  assert.match(html, /<input name="port" value="51821"/)
  assert.match(html, /Don't forget to update the config on home's devices\./)
  assert.equal((await request('/nodes/9/port', { headers: { cookie: await session() } })).status, 404)
})

test('an offline node\'s port says it can change once it is back', async () => {
  answer('', 255)
  assert.match(await page('/nodes/1/port'), /home is offline\. Its port can change once it is back\./)
})

test('changing a port moves the devices\' configs, saves it and goes back to the tree', async () => {
  answer('')
  const res = await changePort(await session(), 'port=443')
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), '/')
  assert.match(readFileSync(join(dir, 'ssh.log'), 'utf8'), /sed -i '\/\^Endpoint = \/s\/:\[0-9\]\*\$\/:443\/'/)
  assert.deepEqual(load().nodes.map((node) => node.port), [443])
})

test('a port against the rule is refused with a note, keeping what was typed', async () => {
  const cookie = await session()
  for (const body of ['', 'port=', 'port=0', 'port=65536', 'port=4.4', 'port=4%2243']) {
    answer(wg0)
    const res = await changePort(cookie, body)
    assert.equal(res.status, 400, body)
    const html = await res.text()
    assert.match(html, /<div class="note">A port is a whole number from 1 to 65535\.<\/div>/)
    assert.ok(html.includes(`<input name="port" value="${body === 'port=4%2243' ? '4&#34;43' : body.slice(5)}"`), body)
  }
  assert.deepEqual(load().nodes, nodes)
})

test('a port the hub or another node uses is refused with a note', async () => {
  save({ password: hash(password), nodes: [...nodes, { name: 'work', n: 2, port: 51822, publicKey: 'work' }], joins: [] })
  const cookie = await session()
  for (const port of [51820, 51822]) {
    answer(wg0)
    const res = await changePort(cookie, `port=${port}`)
    assert.equal(res.status, 409)
    assert.match(await res.text(), /<div class="note">The hub or another node already uses that port\.<\/div>/)
  }
  assert.deepEqual(load().nodes.map((node) => node.port), [51821, 51822])
})

test('changing the port of an offline node says so, changing nothing', async () => {
  answer('', 255)
  const res = await changePort(await session(), 'port=443')
  assert.equal(res.status, 503)
  assert.match(await res.text(), /home is offline\. Its port can change once it is back\./)
  assert.deepEqual(load().nodes, nodes)
})

test('a node still waiting to join changes its port without being reached', async () => {
  save({ password: hash(password), nodes, joins: [{ token: 'abc', n: 1, privateKey: 'key', expires: Date.now() + 60_000 }] })
  answer('', 255)
  const cookie = await session()
  const html = await (await request('/nodes/1/port', { headers: { cookie } })).text()
  assert.match(html, /<input name="port" value="51821"/)
  assert.doesNotMatch(html, /class="warn"|is offline/)
  assert.equal((await changePort(cookie, 'port=443')).status, 303)
  assert.deepEqual(load().nodes.map((node) => node.port), [443])
})

function changeHubPort(cookie: string, body: string) {
  return request('/hub/port', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
}

test('the hub\'s port opens over the tree, prefilled', async () => {
  online()
  writeFileSync(join(dir, 'listen-port'), '443\n')
  const html = await page('/hub/port')
  assert.match(html, /<h2 id="modal-title">Hub's port<\/h2>/)
  assert.match(html, /<input name="port" value="443"/)
})

test('the hub\'s port names the offline nodes it waits for', async () => {
  assert.match(await page('/hub/port'), /home is offline\. Wait until it is back to change the hub's port, or remove it if it is gone for good\./)
})

test('changing the hub\'s port moves every node and the hub, and goes back to the tree', async () => {
  online()
  answer('')
  const res = await changeHubPort(await session(), 'port=443')
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), '/')
  assert.match(readFileSync(join(dir, 'ssh.log'), 'utf8'), /^mv \/etc\/wireguard\/postern0\.conf\.next \/etc\/wireguard\/postern0\.conf$/m)
  assert.equal(readFileSync(join(dir, 'listen-port'), 'utf8'), '443\n')
})

test('the hub\'s port against the rule, or a node\'s, is refused with a note, keeping what was typed', async () => {
  online()
  const cookie = await session()
  const bad = await changeHubPort(cookie, 'port=4%2243')
  assert.equal(bad.status, 400)
  const html = await bad.text()
  assert.match(html, /<div class="note">A port is a whole number from 1 to 65535\.<\/div>/)
  assert.match(html, /<input name="port" value="4&#34;43"/)
  const taken = await changeHubPort(cookie, 'port=51821')
  assert.equal(taken.status, 409)
  assert.match(await taken.text(), /<div class="note">A node already uses that port\.<\/div>/)
  assert.equal(existsSync(join(dir, 'listen-port')), false)
})

test('a port another service on the hub holds is refused with a note', async () => {
  online()
  writeFileSync(join(dir, 'busy-port'), '53\n')
  const res = await changeHubPort(await session(), 'port=53')
  assert.equal(res.status, 409)
  assert.match(await res.text(), /<div class="note">Something else on the hub already uses that port\.<\/div>/)
  assert.doesNotMatch(readFileSync(join(dir, 'ssh.log'), 'utf8'), / sh$/m)
  assert.equal(existsSync(join(dir, 'listen-port')), false)
})

test('changing the hub\'s port while a node cannot be reached names it, changing nothing', async () => {
  online()
  answer('', 255)
  const res = await changeHubPort(await session(), 'port=443')
  assert.equal(res.status, 503)
  assert.match(await res.text(), /home is offline\. Wait until it is back to change the hub's port, or remove it if it is gone for good\./)
  assert.equal(readFileSync(join(dir, 'listen-port'), 'utf8'), '51820\n')
})

test('changing an unknown node\'s port is not found', async () => {
  assert.equal((await changePort(await session(), 'port=443', 9)).status, 404)
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
  for (const [method, path] of [['GET', '/'], ['GET', '/missing'], ['POST', '/logout'], ['POST', '/'], ['POST', '/nodes'], ['POST', '/nodes/1/remove'], ['GET', '/nodes/new'], ['GET', '/nodes/1/join'], ['GET', '/nodes/1/new-device'], ['POST', '/nodes/1/devices'], ['GET', '/nodes/1/devices/mum'], ['GET', '/nodes/1/devices/mum.conf'], ['POST', '/nodes/1/devices/mum/remove']]) {
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

test('an unknown page is not found for a logged-in admin', async () => {
  const cookie = await session()
  for (const [method, path] of [['GET', '/missing'], ['GET', '/logout'], ['POST', '/']]) {
    const res = await request(path, { method, headers: { cookie } })
    assert.equal(res.status, 404)
    assert.match(await res.text(), /<h3>Not found<\/h3>/)
  }
})
