import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { addNode, connect, disconnect, joinCommand, node, output, page, post, row, setPasswordAndLogin, sh, status } from './sim.ts'

const password = 'add device e2e'
let cookie = ''
let conf = ''

before(async () => {
  cookie = await setPasswordAndLogin(password)
})

test('the tablet adds the phone to home-pi and gets its QR code', async () => {
  const { n } = await node('home-pi')
  assert.equal(await post(`/nodes/${n}/devices`, cookie, 'deviceName=phone'), 303)
  assert.match(await row(cookie, 'phone'), /<b>phone<\/b><\/span><\/div><\/td>\n<td class="mono address">10\.66\.66\.\d+<\/td>/)
  assert.match(await page(`/nodes/${n}/devices/phone`, cookie), /<div class="qr"><svg /)
})

test('the tablet downloads the phone\'s .conf, dialing home-pi\'s port on the hub', async () => {
  const { n } = await node('home-pi')
  conf = await page(`/nodes/${n}/devices/phone.conf`, cookie)
  assert.match(conf, new RegExp(`^Endpoint = hub:${51820 + n}$`, 'm'))
  assert.equal(conf, await output('home-pi', 'cat /etc/wireguard/clients/phone.conf'))
})

test('home-pi runs the phone as a peer, live and in its wg0.conf', async () => {
  const x = conf.match(/^Address = 10\.66\.66\.(\d+)\/32$/m)?.[1]
  assert.match(await output('home-pi', 'wg show wg0 allowed-ips'), new RegExp(`\\t10\\.66\\.66\\.${x}/32$`, 'm'))
  assert.match(await output('home-pi', 'cat /etc/wireguard/wg0.conf'), new RegExp(`^### Client phone\\n\\[Peer\\]\\nPublicKey = \\S+\\nAllowedIPs = 10\\.66\\.66\\.${x}/32$`, 'm'))
  assert.equal(await output('home-pi', 'stat -c %a /etc/wireguard/wg0.conf /etc/wireguard/clients/phone.conf'), '600\n600')
})

test('the phone, behind the carrier NAT, reaches home-pi\'s LAN and the internet from the home IP, and shows online', async () => {
  assert.equal(await status(cookie, 'phone'), 'offline')
  try {
    const setup = await connect('phone', conf)
    assert.equal(setup.code, 0, setup.out)
    assert.equal((await sh('phone', 'ping -c 3 -W 5 10.66.66.1')).code, 0)
    assert.equal(await status(cookie, 'phone'), 'online')
    assert.deepEqual(JSON.parse(await output('phone', 'curl -s -m 5 http://192.168.1.30')), { server: 'camera', client: '192.168.1.10' })
    assert.deepEqual(JSON.parse(await output('phone', 'curl -s -m 5 http://example.com')), { server: 'example.com', client: '172.30.0.20' })
  } finally {
    await disconnect('phone')
  }
})

test('a device name already on home-pi, in any case, is refused', async () => {
  const { n } = await node('home-pi')
  assert.equal(await post(`/nodes/${n}/devices`, cookie, 'deviceName=PHONE'), 409)
})

async function joinWorkPi() {
  assert.equal(await addNode(cookie, 'work-pi'), 303)
  const command = await joinCommand(cookie, 'work-pi')
  const { code, out } = await sh('work-pi', command)
  assert.equal(code, 0, out)
  return (await node('work-pi')).n
}

// work-pi takes a new host key between its two joins, as a different Pi given the freed number would have.
test('a node given a removed node\'s number is reached over SSH, despite its new host key', async () => {
  const numbers = []
  for (const round of [1, 2]) {
    const n = await joinWorkPi()
    numbers.push(n)
    assert.equal(await status(cookie, 'work-pi'), 'online', `round ${round}`)
    assert.equal(await post(`/nodes/${n}/remove`, cookie, ''), 303)
    await sh('work-pi', 'rm /etc/ssh/ssh_host_* && ssh-keygen -A && systemctl restart ssh')
  }
  assert.equal(numbers[0], numbers[1])
})

// spare takes work-pi's freed number, so work-pi joins again under a new one.
test('a node joining again under a new number moves its devices\' configs to its new port', async () => {
  const before = await joinWorkPi()
  assert.equal(await post(`/nodes/${before}/devices`, cookie, 'deviceName=laptop'), 303)
  assert.equal(await post(`/nodes/${before}/remove`, cookie, ''), 303)
  assert.equal(await addNode(cookie, 'spare'), 303)
  const after = await joinWorkPi()
  assert.notEqual(after, before)
  assert.match(await page(`/nodes/${after}/devices/laptop.conf`, cookie), new RegExp(`^Endpoint = hub:${51820 + after}$`, 'm'))
  for (const name of ['spare', 'work-pi']) {
    assert.equal(await post(`/nodes/${(await node(name)).n}/remove`, cookie, ''), 303)
  }
})
