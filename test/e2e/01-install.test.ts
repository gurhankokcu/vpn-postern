import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { install, login, output, page, stage } from './sim.ts'

const password = ' open sesame twice '

before(async () => {
  assert.equal((await stage()).code, 0)
})

test('answering no changes nothing', async () => {
  const { code, out } = await install(['n'])
  assert.equal(code, 1)
  assert.match(out, /Install wireguard-tools nftables qrencode with apt\? \[y\/N\]/)
  assert.match(out, /Stopped\. Nothing was changed\./)
  assert.equal(await output('hub', 'ls -d /opt/postern /var/lib/postern /usr/local/bin/postern 2>/dev/null'), '')
  assert.equal(await output('hub', "dpkg-query -W -f='${Status}' wireguard-tools 2>/dev/null"), '')
})

test('a fresh install runs to the end', async () => {
  const { code, out } = await install(['y', password, password, ''])
  assert.equal(code, 0, out)
  assert.match(out, /VPN Postern is running at https:\/\/172\.30\.0\.10:8443$/)
})

test('the hub runs postern and postern0', async () => {
  assert.equal(await output('hub', 'systemctl is-active postern wg-quick@postern0'), 'active\nactive')
  assert.equal(await output('hub', 'wg show postern0 listen-port'), '51820')
  assert.match(await output('hub', 'ip -o -4 addr show postern0'), /inet 10\.99\.0\.1\/24 /)
})

test('the install is owned by root, though its source is not, and has no tests', async () => {
  assert.equal(await output('hub', 'stat -c %u /srv/postern/package.json'), '1001')
  assert.equal(await output('hub', 'find /opt/postern /usr/local/bin/postern ! -user root'), '')
  assert.equal(await output('hub', "find /opt/postern -name '*.test.ts'"), '')
  assert.equal(await output('hub', 'ls /opt/postern'), 'package.json\nsrc')
})

test('the data is readable by root alone', async () => {
  assert.equal(await output('hub', 'stat -c %a /var/lib/postern /var/lib/postern/data.json /etc/wireguard/postern0.conf'), '700\n600\n600')
  assert.equal(await output('hub', 'ls /var/lib/postern'), 'data.json\nid_ed25519\nid_ed25519.pub\npostern.nft\ntls.crt\ntls.key')
})

test('the tablet finds the login page', async () => {
  assert.match(await page('/login'), /action="\/login"/)
})

test('the password without its spaces is refused', async () => {
  assert.equal((await login('open sesame twice')).status, 401)
})

test('the password, spaces and all, logs in and shows the nodes', async () => {
  const { status, cookie } = await login(password)
  assert.equal(status, 303)
  assert.match(await page('/', cookie), /No nodes yet/)
})
