import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { login, output, page, post, sh } from './sim.ts'

const password = 'join node e2e'
let cookie = ''
let command = ''

before(async () => {
  assert.equal((await sh('hub', `printf '%s\\n' '${password}' | postern set-password`)).code, 0)
  cookie = (await login(password)).cookie
})

async function data() {
  return JSON.parse(await output('hub', 'cat /var/lib/postern/data.json'))
}

async function address() {
  return `10.99.0.${(await node()).n}`
}

function token() {
  return command.match(/\/join\/([0-9a-f]{64}) /)?.[1]
}

function fetchOnly(pin?: string) {
  const curl = command.split(' | ')[0]
  return pin ? curl.replace(/sha256\/\/\S+/, `sha256//${pin}`) : curl
}

async function node() {
  return (await data()).nodes.find((node: { name: string }) => node.name === 'home-pi')
}

async function status() {
  return (await page('/', cookie)).match(/<td><b>home-pi<\/b><\/td>\n<td><span class="pill (\w+)">/)?.[1]
}

async function readCommand() {
  const html = await page('/', cookie)
  command = html.match(/<td><b>home-pi<\/b><\/td>[\s\S]*?<code class="mono">(curl [^<]+)<\/code>/)?.[1] ?? ''
  assert.match(command, /^curl -fsSk --pinnedpubkey sha256\/\/\S+ https:\/\/hub:8443\/join\/[0-9a-f]{64} \| sudo sh$/)
}

test('the tablet adds home-pi and sees its join command', async () => {
  assert.equal(await post('/nodes', cookie, 'nodeName=home-pi'), 303)
  await readCommand()
  assert.equal(await status(), 'offline')
})

test('with the wrong pin, home-pi refuses the hub and the command stays unused', async () => {
  const { code } = await sh('home-pi', fetchOnly(`${'A'.repeat(43)}=`))
  assert.equal(code, 90)
  assert.ok((await data()).joins.some((join: { token: string }) => join.token === token()))
})

test('home-pi runs the join command', async () => {
  const { code, out } = await sh('home-pi', command)
  assert.equal(code, 0, out)
  assert.match(out, new RegExp(`Joined VPN Postern as ${(await address()).replaceAll('.', '\\.')}\\.$`))
})

test('the tunnel carries traffic both ways', async () => {
  assert.equal((await sh('home-pi', 'ping -c 3 -W 5 10.99.0.1')).code, 0)
  assert.equal((await sh('hub', `ping -c 3 -W 5 ${await address()}`)).code, 0)
})

test('the tablet sees home-pi online', async () => {
  assert.equal(await status(), 'online')
})

test('the hub runs commands on home-pi over SSH', async () => {
  const ssh = `ssh -i /var/lib/postern/id_ed25519 -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 root@${await address()}`
  const { code, out } = await sh('hub', `${ssh} hostname`)
  assert.equal(code, 0, out)
  assert.match(out, /home-pi$/)
})

test('home-pi starts postern0 and ssh on every boot', async () => {
  assert.equal(await output('home-pi', 'systemctl is-enabled wg-quick@postern0 ssh'), 'enabled\nenabled')
})

test('the join command works once', async () => {
  assert.equal((await sh('home-pi', fetchOnly())).code, 22)
  assert.ok(!(await data()).joins.some((join: { token: string }) => join.token === token()))
  assert.ok(!(await page('/', cookie)).includes(`/join/${token()}`))
})
