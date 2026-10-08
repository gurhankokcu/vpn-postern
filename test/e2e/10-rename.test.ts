import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { connect, disconnect, node, output, page, post, row, setPasswordAndLogin, sh } from './sim.ts'

const password = 'rename node and device e2e'
let cookie = ''
let n = 0

before(async () => {
  cookie = await setPasswordAndLogin(password)
  n = (await node('home-pi')).n
})

after(() => disconnect('tablet'))

function reachesCamera() {
  return sh('tablet', 'curl -s -m 5 http://192.168.1.30')
}

test('the tablet renames home-pi on the hub alone, and back', async () => {
  const before = await output('home-pi', 'cat /etc/wireguard/wg0.conf')
  assert.equal(await post(`/nodes/${n}/name`, cookie, 'name=London-Pi'), 303)
  assert.equal((await node('London-Pi')).n, n)
  assert.match(await row(cookie, 'London-Pi'), new RegExp(`href="/nodes/${n}/name" aria-label="Rename"`))
  assert.equal(await output('home-pi', 'cat /etc/wireguard/wg0.conf'), before)
  assert.equal(await post(`/nodes/${n}/name`, cookie, 'name=home-pi'), 303)
  assert.equal((await node('home-pi')).n, n)
})

test('the tablet renames itself on home-pi, keeping its keys and address, and stays connected', async () => {
  const conf = await page(`/nodes/${n}/devices/tablet.conf`, cookie)
  const setup = await connect('tablet', conf)
  assert.equal(setup.code, 0, setup.out)
  const peer = await output('home-pi', 'wg show wg0 allowed-ips')
  assert.equal(await post(`/nodes/${n}/devices/tablet/name`, cookie, 'name=ipad'), 303)
  assert.match(await output('home-pi', 'cat /etc/wireguard/wg0.conf'), /^### Client ipad$/m)
  assert.doesNotMatch(await output('home-pi', 'cat /etc/wireguard/wg0.conf'), /^### Client tablet$/m)
  assert.equal(await output('home-pi', 'cat /etc/wireguard/clients/ipad.conf'), conf)
  assert.equal((await sh('home-pi', 'test -e /etc/wireguard/clients/tablet.conf')).code, 1)
  assert.equal(await output('home-pi', 'wg show wg0 allowed-ips'), peer)
  assert.equal((await reachesCamera()).code, 0)
  assert.equal(await page(`/nodes/${n}/devices/ipad.conf`, cookie), conf)
})

test('a name another device on home-pi has, in any case, is refused', async () => {
  assert.equal(await post(`/nodes/${n}/devices/ipad/name`, cookie, 'name=LAPTOP'), 409)
  assert.match(await output('home-pi', 'cat /etc/wireguard/wg0.conf'), /^### Client ipad$/m)
})
