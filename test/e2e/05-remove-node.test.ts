import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { addNode, joinCommand, node, output, post, row, setPasswordAndLogin, sh, status } from './sim.ts'

const password = 'remove node e2e'
let cookie = ''
let command = ''
let n = 0
let publicKey = ''
let serverKey = ''

before(async () => {
  cookie = await setPasswordAndLogin(password)
})

async function add() {
  assert.equal(await addNode(cookie, 'work-pi'), 303)
  ;({ n, publicKey } = await node('work-pi'))
  command = await joinCommand(cookie, 'work-pi')
  assert.match(command, /^curl -fsSk --pinnedpubkey sha256\/\/\S+ https:\/\/hub:8443\/join\/[0-9a-f]{64} \| sudo sh$/)
}

async function join() {
  const { code, out } = await sh('work-pi', command)
  assert.equal(code, 0, out)
  assert.equal((await sh('work-pi', 'ping -c 3 -W 5 10.99.0.1')).code, 0)
  assert.equal(await status(cookie, 'work-pi'), 'online')
  assert.equal((await sh('hub', `test -S /var/lib/postern/ssh-10.99.0.${n}`)).code, 0)
}

async function wg0() {
  return { key: await output('work-pi', 'wg show wg0 public-key'), port: Number(await output('work-pi', 'wg show wg0 listen-port')) }
}

async function remove() {
  assert.equal(await post(`/nodes/${n}/remove`, cookie, ''), 303)
  assert.equal(await node('work-pi'), undefined)
  assert.equal(await row(cookie, 'work-pi'), '')
  assert.equal((await sh('hub', `test -e /var/lib/postern/ssh-10.99.0.${n}`)).code, 1)
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
  assert.equal(await addNode(cookie, 'spare'), 303)
  await add()
  assert.notEqual(n, removed)
  await join()
  assert.deepEqual(await wg0(), { key: serverKey, port: 51820 + n })
  assert.equal(await post(`/nodes/${(await node('spare')).n}/remove`, cookie, ''), 303)
})

test('home-pi is untouched by all of this', async () => {
  assert.equal((await sh('hub', `ping -c 3 -W 5 10.99.0.${(await node('home-pi')).n}`)).code, 0)
})
