import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { node, output, page, post, setPasswordAndLogin, sh } from './sim.ts'

const password = 'add node e2e'
let cookie = ''

before(async () => {
  cookie = await setPasswordAndLogin(password)
})

async function publicKey(name: string) {
  return (await node(name)).publicKey
}

function peers() {
  return output('hub', 'wg show postern0 allowed-ips')
}

test('the tablet adds a node and sees it listed', async () => {
  assert.equal(await post('/nodes', cookie, 'nodeName=Home Pi'), 303)
  assert.match(await page('/', cookie), /<td><b>Home Pi<\/b><\/td>\n<td><span class="pill offline">offline<\/span><\/td>\n<td class="mono">10\.99\.0\.2<\/td>/)
})

test('the node is a live postern0 peer at 10.99.0.2', async () => {
  assert.equal(await peers(), `${await publicKey('Home Pi')}\t10.99.0.2/32`)
})

test('a second node takes 10.99.0.3', async () => {
  assert.equal(await post('/nodes', cookie, 'nodeName=Work Pi'), 303)
  assert.equal(await peers(), `${await publicKey('Home Pi')}\t10.99.0.2/32\n${await publicKey('Work Pi')}\t10.99.0.3/32`)
})

test('postern0.conf keeps the interface and both peers, readable by root alone', async () => {
  const conf = await output('hub', 'cat /etc/wireguard/postern0.conf')
  assert.match(conf, /^Address = 10\.99\.0\.1\/24$/m)
  assert.match(conf, /^ListenPort = 443$/m)
  assert.ok(conf.includes(`PrivateKey = ${await output('hub', 'wg show postern0 private-key')}\n`))
  assert.ok(conf.includes(`[Peer]\nPublicKey = ${await publicKey('Home Pi')}\nAllowedIPs = 10.99.0.2/32`))
  assert.ok(conf.includes(`[Peer]\nPublicKey = ${await publicKey('Work Pi')}\nAllowedIPs = 10.99.0.3/32`))
  assert.equal(await output('hub', 'stat -c %a /etc/wireguard/postern0.conf'), '600')
})

test('restarting postern0 brings back the same interface and peers', async () => {
  const key = await output('hub', 'wg show postern0 private-key')
  const before = await peers()
  assert.equal((await sh('hub', 'systemctl restart wg-quick@postern0')).code, 0)
  assert.equal(await output('hub', 'wg show postern0 private-key'), key)
  assert.equal(await peers(), before)
  assert.match(await output('hub', 'ip -o -4 addr show postern0'), /inet 10\.99\.0\.1\/24 /)
})
