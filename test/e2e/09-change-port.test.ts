import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { addNode, connect, disconnect, joinCommand, node, output, page, post, restart, setPasswordAndLogin, sh } from './sim.ts'

const password = 'change port e2e'
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

async function table() {
  return output('hub', 'nft list table inet postern')
}

test('home-pi\'s port moves: the hub forwards the new one and not the old', async () => {
  assert.equal(await post(`/nodes/${n}/port`, cookie, 'port=1194'), 303)
  assert.equal((await node('home-pi')).port, 1194)
  const forwards = await table()
  assert.match(forwards, new RegExp(`udp dport 1194 dnat ip to 10\\.99\\.0\\.${n}:${51820 + n}`))
  assert.ok(!forwards.includes(`udp dport ${51820 + n} `))
})

test('home-pi\'s devices\' configs dial its new port', async () => {
  for (const name of ['tablet', 'laptop']) {
    assert.match(await output('home-pi', `cat /etc/wireguard/clients/${name}.conf`), /^Endpoint = hub:1194$/m, name)
  }
})

test('the tablet, with its config downloaded again, reaches home-pi\'s LAN through the new port', async () => {
  const conf = await page(`/nodes/${n}/devices/tablet.conf`, cookie)
  assert.match(conf, /^Endpoint = hub:1194$/m)
  const setup = await connect('tablet', conf)
  assert.equal(setup.code, 0, setup.out)
  assert.equal((await reachesCamera()).code, 0)
})

// The program holds the port for 10 seconds, long enough for the hub to be asked for it.
test('a port another program on the hub holds is refused, and the hub keeps its own', async () => {
  const holder = sh('hub', `timeout 10 node -e 'require("node:dgram").createSocket("udp4").bind(7000)'`)
  await sh('hub', 'for i in $(seq 20); do ss -Hlun "sport = :7000" | grep -q . && break; sleep 0.5; done')
  assert.equal(await post('/hub/port', cookie, 'port=7000'), 409)
  assert.equal(await output('hub', 'wg show postern0 listen-port'), '443')
  assert.match(await output('home-pi', 'cat /etc/wireguard/postern0.conf'), /^Endpoint = hub:443$/m)
  await holder
})

test('work-pi, added but not joined, changes its port without being reached', async () => {
  assert.equal(await addNode(cookie, 'work-pi'), 303)
  const { n: w } = await node('work-pi')
  assert.equal(await post(`/nodes/${w}/port`, cookie, 'port=1195'), 303)
  assert.equal((await node('work-pi')).port, 1195)
  assert.match(await table(), new RegExp(`udp dport 1195 dnat ip to 10\\.99\\.0\\.${w}:${51820 + w}`))
})

test('the hub moves to its new port, keeps it, and home-pi follows it', async () => {
  assert.equal(await post('/hub/port', cookie, 'port=4500'), 303)
  assert.equal(await output('hub', 'wg show postern0 listen-port'), '4500')
  assert.match(await output('hub', 'cat /etc/wireguard/postern0.conf'), /^ListenPort = 4500$/m)
  assert.match(await output('home-pi', 'cat /etc/wireguard/postern0.conf'), /^Endpoint = hub:4500$/m)
  const endpoint = await output('home-pi', 'for i in $(seq 20); do wg show postern0 endpoints | grep -q ":4500$" && break; sleep 1; done; wg show postern0 endpoints')
  assert.match(endpoint, /:4500$/)
  assert.equal((await sh('hub', `ping -c 3 -W 5 10.99.0.${n}`)).code, 0)
  assert.match(await page('/', cookie), /<b>laptop<\/b>/)
})

test('the tablet stays connected through home-pi, as devices do not dial the hub\'s port', async () => {
  assert.equal((await reachesCamera()).code, 0)
})

test('work-pi then joins, dialing the hub\'s new port, and its devices dial the port it was given', async () => {
  const { code, out } = await sh('work-pi', await joinCommand(cookie, 'work-pi'))
  assert.equal(code, 0, out)
  const { n: w } = await node('work-pi')
  assert.match(await output('work-pi', 'cat /etc/wireguard/postern0.conf'), /^Endpoint = hub:4500$/m)
  assert.equal((await sh('hub', `ping -c 3 -W 5 10.99.0.${w}`)).code, 0)
  assert.equal(await post(`/nodes/${w}/devices`, cookie, 'deviceName=desk'), 303)
  assert.match(await page(`/nodes/${w}/devices/desk.conf`, cookie), /^Endpoint = hub:1195$/m)
  assert.equal(await post(`/nodes/${w}/remove`, cookie, ''), 303)
})

test('after a restart the hub listens on its new port, and home-pi reconnects', async () => {
  await restart('hub')
  const active = await output('hub', 'for i in $(seq 30); do systemctl is-active -q postern 2>/dev/null && break; sleep 1; done; systemctl is-active postern')
  assert.equal(active, 'active')
  assert.equal(await output('hub', 'wg show postern0 listen-port'), '4500')
  assert.equal((await sh('hub', `ping -c 3 -W 5 10.99.0.${n}`)).code, 0)
})
