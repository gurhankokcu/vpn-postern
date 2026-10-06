import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { connect, disconnect, node, output, page, post, setPasswordAndLogin, sh } from './sim.ts'

const password = 'remove device e2e'
let cookie = ''
let n = 0
let phone = ''

before(async () => {
  cookie = await setPasswordAndLogin(password)
  n = (await node('home-pi')).n
  phone = await page(`/nodes/${n}/devices/phone.conf`, cookie)
})

after(async () => {
  await disconnect('phone')
  await disconnect('tablet')
})

function reachesCamera(machine: string) {
  return sh(machine, 'curl -s -m 5 http://192.168.1.30')
}

test('the tablet and the phone both reach home-pi\'s LAN through their own devices', async () => {
  assert.equal(await post(`/nodes/${n}/devices`, cookie, 'deviceName=tablet'), 303)
  const tablet = await page(`/nodes/${n}/devices/tablet.conf`, cookie)
  for (const [machine, conf] of [['tablet', tablet], ['phone', phone]]) {
    const setup = await connect(machine, conf)
    assert.equal(setup.code, 0, setup.out)
    assert.equal((await sh(machine, 'ping -c 3 -W 5 10.66.66.1')).code, 0)
    assert.equal((await reachesCamera(machine)).code, 0)
  }
})

test('the tablet removes the phone, which drops off home-pi', async () => {
  assert.equal(await post(`/nodes/${n}/devices/phone/remove`, cookie, ''), 303)
  assert.doesNotMatch(await page(`/nodes/${n}`, cookie), /<b>phone<\/b>/)
  assert.doesNotMatch(await output('home-pi', 'cat /etc/wireguard/wg0.conf'), /### Client phone/)
  assert.equal((await sh('home-pi', 'test -e /etc/wireguard/clients/phone.conf')).code, 1)
})

test('the phone can no longer get through, while the tablet stays connected', async () => {
  assert.notEqual((await reachesCamera('phone')).code, 0)
  assert.equal((await reachesCamera('tablet')).code, 0)
})

test('the phone\'s .conf is gone and a second remove is not found', async () => {
  assert.match(await page(`/nodes/${n}/devices/phone.conf`, cookie), /<h3>Not found<\/h3>/)
  assert.equal(await post(`/nodes/${n}/devices/phone/remove`, cookie, ''), 404)
})

test('the phone\'s address goes to the next device added', async () => {
  const x = phone.match(/^Address = (10\.66\.66\.\d+)\/32$/m)?.[1]
  assert.equal(await post(`/nodes/${n}/devices`, cookie, 'deviceName=laptop'), 303)
  assert.match(await page(`/nodes/${n}/devices/laptop.conf`, cookie), new RegExp(`^Address = ${x?.replaceAll('.', '\\.')}/32$`, 'm'))
})
