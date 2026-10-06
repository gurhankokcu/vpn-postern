import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { login, output, page, post, sh } from './sim.ts'

const password = 'remove node e2e'
let cookie = ''
let command = ''
let n = 0
let publicKey = ''
let serverKey = ''

before(async () => {
  assert.equal((await sh('hub', `printf '%s\\n' '${password}' | postern set-password`)).code, 0)
  cookie = (await login(password)).cookie
})

async function node(name = 'work-pi') {
  const data = JSON.parse(await output('hub', 'cat /var/lib/postern/data.json'))
  return data.nodes.find((node: { name: string }) => node.name === name)
}

async function row() {
  return (await page('/', cookie)).match(/<td><b>work-pi<\/b><\/td>[\s\S]*?<\/tr>(\n<tr class="join">.*<\/tr>)?/)?.[0] ?? ''
}

async function add() {
  assert.equal(await post('/nodes', cookie, 'nodeName=work-pi'), 303)
  ;({ n, publicKey } = await node())
  command = (await row()).match(/<code class="mono">(curl [^<]+)<\/code>/)?.[1] ?? ''
  assert.match(command, /^curl -fsSk --pinnedpubkey sha256\/\/\S+ https:\/\/hub:8443\/join\/[0-9a-f]{64} \| sudo sh$/)
}

async function join() {
  const { code, out } = await sh('work-pi', command)
  assert.equal(code, 0, out)
  assert.equal((await sh('work-pi', 'ping -c 3 -W 5 10.99.0.1')).code, 0)
  assert.match(await row(), /<span class="pill online">online<\/span>/)
}

async function wg0() {
  return { key: await output('work-pi', 'wg show wg0 public-key'), port: Number(await output('work-pi', 'wg show wg0 listen-port')) }
}

async function remove() {
  assert.equal(await post(`/nodes/${n}/remove`, cookie, ''), 303)
  assert.equal(await node(), undefined)
  assert.equal(await row(), '')
  for (const peers of [await output('hub', 'wg show postern0 peers'), await output('hub', 'cat /etc/wireguard/postern0.conf')]) {
    assert.ok(!peers.includes(publicKey))
  }
}

test('the tablet adds work-pi and removes it before it joins, so its join command stops working', async () => {
  await add()
  await remove()
  assert.equal((await sh('work-pi', command.split(' | ')[0])).code, 22)
})

test('the tablet adds work-pi again, it gets the same address back and joins', async () => {
  const removed = n
  await add()
  assert.equal(n, removed)
  await join()
  const { key, port } = await wg0()
  serverKey = key
  assert.equal(port, 51820 + n)
})

test('the tablet removes the joined work-pi, and the hub can no longer reach it', async () => {
  await remove()
  assert.notEqual((await sh('hub', `ping -c 2 -W 2 10.99.0.${n}`)).code, 0)
})

test('work-pi, re-added, joins again, replacing its old config', async () => {
  await add()
  await join()
  assert.equal((await sh('hub', `ping -c 3 -W 5 10.99.0.${n}`)).code, 0)
  assert.deepEqual(await wg0(), { key: serverKey, port: 51820 + n })
})

test('work-pi, re-added under another number, keeps its wg0 key and listens on its new port', async () => {
  const removed = n
  await remove()
  assert.equal(await post('/nodes', cookie, 'nodeName=spare'), 303)
  await add()
  assert.notEqual(n, removed)
  await join()
  assert.deepEqual(await wg0(), { key: serverKey, port: 51820 + n })
  assert.equal(await post(`/nodes/${(await node('spare')).n}/remove`, cookie, ''), 303)
})

test('home-pi is untouched by all of this', async () => {
  assert.equal((await sh('hub', `ping -c 3 -W 5 10.99.0.${(await node('home-pi')).n}`)).code, 0)
})
