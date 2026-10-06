import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { login, output, post, restart, sh } from './sim.ts'

const password = 'forward node e2e'
let cookie = ''

before(async () => {
  assert.equal((await sh('hub', `printf '%s\\n' '${password}' | postern set-password`)).code, 0)
  cookie = (await login(password)).cookie
})

async function node(name: string) {
  const data = JSON.parse(await output('hub', 'cat /var/lib/postern/data.json'))
  return data.nodes.find((node: { name: string }) => node.name === name)
}

// The machine listens on port, while the tablet sends to the hub's port, a few times a second.
// wg0 holds the port, so it steps aside while the machine listens.
async function udp(machine: string, port: number, seconds: number) {
  await sh(machine, 'systemctl stop wg-quick@wg0')
  const listen = sh(machine, `timeout ${seconds} perl -MIO::Socket::INET -e '$s = IO::Socket::INET->new(LocalPort => ${port}, Proto => "udp") or die; $s->recv($m, 100); print $s->peerhost, " ", $m'`)
  await sh('tablet', `node -e 'const s = require("node:dgram").createSocket("udp4"); let i = 0; const t = setInterval(() => { s.send("hello", ${port}, "hub"); if (++i === ${seconds * 4}) { clearInterval(t); s.close() } }, 250)'`)
  const result = await listen
  await sh(machine, 'systemctl start wg-quick@wg0')
  return result
}

async function table() {
  return output('hub', 'nft list table inet postern')
}

test('the hub forwards packets', async () => {
  assert.equal(await output('hub', 'sysctl -n net.ipv4.ip_forward'), '1')
  assert.equal(await output('hub', 'cat /etc/sysctl.d/99-postern.conf'), 'net.ipv4.ip_forward = 1')
})

test('a packet from the tablet to the hub on home-pi\'s port arrives at home-pi on that port, from the hub', async () => {
  const port = 51820 + (await node('home-pi')).n
  assert.deepEqual(await udp('home-pi', port, 10), { code: 0, out: '10.99.0.1 hello' })
})

test('a packet from the tablet to the hub on work-pi\'s port arrives at work-pi on that port, from the hub', async () => {
  const port = 51820 + (await node('work-pi')).n
  assert.deepEqual(await udp('work-pi', port, 10), { code: 0, out: '10.99.0.1 hello' })
})

test('a WireGuard client on the tablet reaches home-pi\'s LAN and the internet through the hub, from the home IP', async () => {
  const port = 51820 + (await node('home-pi')).n
  const serverKey = await output('home-pi', 'wg show wg0 public-key')
  let clientKey = ''
  try {
    const setup = await sh('tablet', [
      'umask 077',
      'wg genkey > /tmp/client.key',
      'ip link add wgt type wireguard',
      `wg set wgt private-key /tmp/client.key peer ${serverKey} endpoint hub:${port} allowed-ips 10.66.66.1/32,192.168.1.0/24,172.30.0.60/32`,
      'ip addr add 10.66.66.200/32 dev wgt',
      'ip link set wgt mtu 1340 up',
      'ip route add 10.66.66.1/32 dev wgt',
      'ip route add 192.168.1.0/24 dev wgt',
      'ip route add 172.30.0.60/32 dev wgt',
      'wg pubkey < /tmp/client.key',
    ].join(' && '))
    assert.equal(setup.code, 0, setup.out)
    clientKey = setup.out
    assert.equal((await sh('home-pi', `wg set wg0 peer ${clientKey} allowed-ips 10.66.66.200/32`)).code, 0)
    assert.equal((await sh('tablet', 'ping -c 3 -W 5 10.66.66.1')).code, 0)
    assert.equal((await sh('tablet', 'ping -c 1 -W 5 -M do -s 1312 10.66.66.1')).code, 0)
    assert.deepEqual(JSON.parse(await output('tablet', 'curl -s -m 5 http://192.168.1.30')), { server: 'camera', client: '192.168.1.10' })
    assert.deepEqual(JSON.parse(await output('tablet', 'curl -s -m 5 http://example.com')), { server: 'example.com', client: '172.30.0.20' })
  } finally {
    await sh('home-pi', `wg set wg0 peer ${clientKey} remove`)
    await sh('tablet', 'ip link del wgt; rm -f /tmp/client.key')
  }
})

test('after work-pi is removed, its forward is gone and home-pi\'s stays', async () => {
  const { n } = await node('work-pi')
  assert.equal(await post(`/nodes/${n}/remove`, cookie, ''), 303)
  assert.ok(!(await table()).includes(`udp dport ${51820 + n} `))
  assert.deepEqual(await udp('work-pi', 51820 + n, 5), { code: 124, out: '' })
  const port = 51820 + (await node('home-pi')).n
  assert.deepEqual(await udp('home-pi', port, 10), { code: 0, out: '10.99.0.1 hello' })
})

test('after a reboot the hub forwards again', async () => {
  await restart('hub')
  const active = await output('hub', 'for i in $(seq 30); do systemctl is-active -q postern 2>/dev/null && break; sleep 1; done; systemctl is-active postern')
  assert.equal(active, 'active')
  assert.equal(await output('hub', 'sysctl -n net.ipv4.ip_forward'), '1')
  const { n } = await node('home-pi')
  assert.match(await table(), new RegExp(`udp dport ${51820 + n} dnat ip to 10\\.99\\.0\\.${n}:${51820 + n}`))
  assert.match(await table(), /oifname "postern0" masquerade/)
})
