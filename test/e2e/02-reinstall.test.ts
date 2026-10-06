import assert from 'node:assert/strict'
import { test } from 'node:test'
import { install, login, output, restart } from './sim.ts'

const password = ' open sesame twice '
const fresh = 'new password'
const prompt = /VPN Postern is already installed\. \[u\]pdate, keeping nodes and users \/ \[r\]eset, erasing everything \/ \[c\]ancel:/
const running = /VPN Postern is running at https:\/\/172\.30\.0\.10:8443$/

function state() {
  return output('hub', [
    'exec 2>&1',
    'sha256sum /var/lib/postern/* /etc/wireguard/postern0.conf',
    'ls -la --time-style=full-iso /opt/postern /usr/local/bin/postern /etc/systemd/system/postern.service',
    'dpkg-query -W wireguard-tools nftables openssl qrencode',
    'systemctl show -p InvocationID postern wg-quick@postern0',
  ].join('; '))
}

function keys() {
  return output('hub', 'sha256sum /var/lib/postern/id_ed25519 /var/lib/postern/tls.key /etc/wireguard/postern0.conf')
}

function started(unit: string) {
  return output('hub', `systemctl show -p InvocationID ${unit}`)
}

test('a user other than root is refused', async () => {
  const before = await state()
  const { code, out } = await install([], 'runuser -u nobody -- bash /mnt/project/install.sh')
  assert.equal(code, 1)
  assert.equal(out, 'Run as root.')
  assert.equal(await state(), before)
})

for (const answer of ['c', 'x', '']) {
  test(`answering ${JSON.stringify(answer)} to update or reset changes nothing`, async () => {
    const before = await state()
    const { code, out } = await install([answer])
    assert.equal(code, 1)
    assert.match(out, prompt)
    assert.match(out, /Stopped\. Nothing was changed\.$/)
    assert.equal(await state(), before)
  })
}

test('a removed package is asked for again, and no changes nothing', async () => {
  await output('hub', 'apt-get remove -y -q qrencode')
  const before = await state()
  const { code, out } = await install(['u', 'n'])
  assert.equal(code, 1)
  assert.match(out, /Install qrencode with apt\? \[y\/N\]/)
  assert.match(out, /Stopped\. Nothing was changed\.$/)
  assert.equal(await state(), before)
})

test('a missing Node.js is asked for, and no changes nothing', async () => {
  await output('hub', 'mv /usr/local/bin/node /usr/local/bin/node.hidden')
  const before = await state()
  const { code, out } = await install(['u', 'y', 'n'])
  await output('hub', 'mv /usr/local/bin/node.hidden /usr/local/bin/node')
  assert.equal(code, 1)
  assert.match(out, /Node\.js 24 is not installed \(found none\)\. Install it from nodejs\.org into \/usr\/local\? \[y\/N\]/)
  assert.match(out, /Stopped\. Nothing was changed\.$/)
  assert.equal(await state(), before)
})

test('an older Node.js is asked for, and no changes nothing', async () => {
  await output('hub', `printf '#!/bin/sh\\nif [ "$1" = --version ]; then\\n  echo v18.19.1\\n  exit 0\\nfi\\nexit 1\\n' > /usr/local/sbin/node && chmod 755 /usr/local/sbin/node`)
  const before = await state()
  const { code, out } = await install(['u', 'y', 'n'])
  await output('hub', 'rm /usr/local/sbin/node')
  assert.equal(code, 1)
  assert.match(out, /Node\.js 24 is not installed \(found v18\.19\.1\)\./)
  assert.match(out, /Stopped\. Nothing was changed\.$/)
  assert.equal(await state(), before)
})

test('yes installs the removed package during the update', async () => {
  const { code, out } = await install(['u', 'Y'])
  assert.equal(code, 0, out)
  assert.match(await output('hub', "dpkg-query -W -f='${Status}' qrencode"), /ok installed/)
})

test('an update replaces the code and restarts postern, keeping data, keys and postern0', async () => {
  await output('hub', 'touch /opt/postern/marker')
  const data = await output('hub', 'sha256sum /var/lib/postern/* /etc/wireguard/postern0.conf')
  const postern = await started('postern')
  const postern0 = await started('wg-quick@postern0')
  const { code, out } = await install(['u'])
  assert.equal(code, 0, out)
  assert.match(out, running)
  assert.doesNotMatch(out, /Admin password/)
  assert.equal(await output('hub', 'ls /opt/postern'), 'package.json\nsrc')
  assert.equal(await output('hub', 'sha256sum /var/lib/postern/* /etc/wireguard/postern0.conf'), data)
  assert.notEqual(await started('postern'), postern)
  assert.equal(await started('wg-quick@postern0'), postern0)
  assert.equal((await login(password)).status, 303)
})

test('the piped form, as curl | bash runs it, updates too', async () => {
  const { code, out } = await install(['u'], 'cat /mnt/project/install.sh | bash')
  assert.equal(code, 0, out)
  assert.match(out, running)
})

test('an update without a password asks for one', async () => {
  await output('hub', 'rm /var/lib/postern/data.json')
  const { code, out } = await install(['u', password, password])
  assert.equal(code, 0, out)
  assert.match(out, /Admin password:/)
  assert.equal((await login(password)).status, 303)
})

test('a reset asks for the password until it is typed twice the same', async () => {
  await output('hub', 'touch /var/lib/postern/stray')
  const before = await keys()
  const postern0 = await started('wg-quick@postern0')
  const { code, out } = await install(['r', '', 'x'.repeat(11), 'x'.repeat(257), fresh, 'typo', fresh, fresh])
  assert.equal(code, 0, out)
  assert.equal(out.match(/A password is 12 to 256 characters\.\nAdmin password:/g)?.length, 3)
  assert.match(out, /Passwords don't match\.\nAdmin password:/)
  assert.match(out, /==> Erasing VPN Postern/)
  assert.match(out, running)
  assert.notEqual(await started('wg-quick@postern0'), postern0)
  const after = (await keys()).split('\n')
  for (const [i, line] of before.split('\n').entries()) {
    assert.notEqual(after[i], line)
  }
})

test('a reset erases the data', async () => {
  assert.equal(await output('hub', 'ls /var/lib/postern'), 'data.json\nid_ed25519\nid_ed25519.pub\npostern.nft\ntls.crt\ntls.key')
  assert.equal(await output('hub', 'systemctl is-active postern wg-quick@postern0'), 'active\nactive')
})

test('after a reset the old password is refused and the new one signs in', async () => {
  assert.equal((await login(password)).status, 401)
  assert.equal((await login(fresh)).status, 303)
})

test('after a reboot postern and postern0 come back by themselves', async () => {
  await restart('hub')
  const active = await output('hub', [
    'for i in $(seq 30); do systemctl is-active -q postern 2>/dev/null && systemctl is-active -q wg-quick@postern0 2>/dev/null && break; sleep 1; done',
    'systemctl is-active postern wg-quick@postern0',
  ].join('; '))
  assert.equal(active, 'active\nactive')
  assert.match(await output('hub', 'ip -o -4 addr show postern0'), /inet 10\.99\.0\.1\/24 /)
  assert.equal((await login(fresh)).status, 303)
})
