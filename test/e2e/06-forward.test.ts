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
async function udp(machine: string, port: number, seconds: number) {
  const listen = sh(machine, `timeout ${seconds} perl -MIO::Socket::INET -e '$s = IO::Socket::INET->new(LocalPort => ${port}, Proto => "udp") or die; $s->recv($m, 100); print $s->peerhost, " ", $m'`)
  await sh('tablet', `node -e 'const s = require("node:dgram").createSocket("udp4"); let i = 0; const t = setInterval(() => { s.send("hello", ${port}, "hub"); if (++i === ${seconds * 4}) { clearInterval(t); s.close() } }, 250)'`)
  return listen
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
