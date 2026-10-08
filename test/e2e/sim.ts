import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

export type Result = { code: number; out: string }

const curl = 'curl -sk --retry 10 --retry-connrefused --retry-delay 1'
const hub = 'https://hub:8443'

function run(command: string, args: string[], input = '') {
  return new Promise<Result>((resolve, reject) => {
    const child = spawn(command, args)
    let out = ''
    child.stdout.on('data', (chunk) => {
      out += chunk
    })
    child.stderr.on('data', (chunk) => {
      out += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? -1, out: out.replaceAll('\r\n', '\n').trim() }))
    child.stdin.end(input)
  })
}

export function sh(machine: string, script: string, input = '') {
  return run('docker', ['exec', '-i', machine, 'sh', '-c', script], input)
}

export async function output(machine: string, script: string) {
  return (await sh(machine, script)).out
}

export function restart(machine: string) {
  return run('docker', ['restart', machine])
}

// Docker Desktop shows the mounted repo as root's, so installs take a copy owned by
// another user, as a release tarball's files are.
export function stage() {
  return sh('hub', 'mkdir /srv/postern && cp -r /mnt/project/package.json /mnt/project/src /srv/postern && chown -R 1001:1001 /srv/postern')
}

// install.sh asks on /dev/tty, so it runs under script, which gives it a terminal fed by the answers.
export function install(answers: string[], command = 'bash /mnt/project/install.sh') {
  return sh('hub', `POSTERN_SOURCE=/srv/postern script -qec '${command}' /dev/null`, answers.map((answer) => `${answer}\n`).join(''))
}

export async function login(password: string) {
  const { out } = await sh('tablet', `${curl} -o /dev/null -D - --data-urlencode password='${password}' ${hub}/login`)
  return {
    status: Number(out.match(/^HTTP\/1\.1 (\d+)/)?.[1] ?? 0),
    cookie: out.match(/^set-cookie: (session=[^;]+)/im)?.[1] ?? '',
  }
}

export async function setPasswordAndLogin(password: string) {
  assert.equal((await sh('hub', `printf '%s\\n' '${password}' | postern set-password`)).code, 0)
  return (await login(password)).cookie
}

export async function data() {
  return JSON.parse(await output('hub', 'cat /var/lib/postern/data.json'))
}

export async function node(name: string) {
  return (await data()).nodes.find((node: { name: string }) => node.name === name)
}

// The machines have no bash for wg-quick, so this does by hand what wg-quick would: wg takes
// the conf without the lines only wg-quick reads, and two half routes send everything else
// through the tunnel, while the hub stays reachable the usual way.
export function connect(machine: string, conf: string) {
  return sh(machine, `set -e
umask 077
cat > /tmp/device.conf
grep -v -e '^Address = ' -e '^DNS = ' -e '^MTU = ' /tmp/device.conf > /tmp/device.wg
ip link add wgc type wireguard
wg setconf wgc /tmp/device.wg
ip addr add $(sed -n 's/^Address = //p' /tmp/device.conf) dev wgc
ip link set wgc mtu $(sed -n 's/^MTU = //p' /tmp/device.conf) up
gateway=$(ip route show default | cut -d ' ' -f 3)
if [ -n "$gateway" ]; then ip route add 172.30.0.10/32 via "$gateway"; fi
ip route add 0.0.0.0/1 dev wgc
ip route add 128.0.0.0/1 dev wgc`, conf)
}

export function disconnect(machine: string) {
  return sh(machine, 'ip link del wgc; ip route del 172.30.0.10/32 2>/dev/null; rm -f /tmp/device.conf /tmp/device.wg')
}

export function page(path: string, cookie = '') {
  return output('tablet', `${curl} -H 'cookie: ${cookie}' ${hub}${path}`)
}

export async function post(path: string, cookie: string, ...data: string[]) {
  const fields = data.map((field) => `--data-urlencode '${field}'`).join(' ')
  return Number(await output('tablet', `${curl} -o /dev/null -w '%{http_code}' -H 'cookie: ${cookie}' ${fields} ${hub}${path}`))
}

// As the admin would: open Add node and keep the port it suggests.
export async function addNode(cookie: string, name: string) {
  const port = (await page('/new-node', cookie)).match(/name="port" value="(\d+)"/)?.[1]
  return post('/nodes', cookie, `name=${name}`, `port=${port}`)
}

export async function joinCommand(cookie: string, name: string) {
  const html = await page(`/nodes/${(await node(name)).n}/join`, cookie)
  return html.match(/<pre tabindex="0">(curl [^<]+)<\/pre>/)?.[1] ?? ''
}

// The tree's row for a node or a device, by its name.
export async function row(cookie: string, name: string) {
  const html = await page('/', cookie)
  return html.match(new RegExp(`<tr[^>]*>\\n<td class="name">(?:(?!</tr>)[\\s\\S])*<b>${name}</b>(?:(?!</tr>)[\\s\\S])*</tr>`))?.[0] ?? ''
}

export async function status(cookie: string, name: string) {
  return (await row(cookie, name)).match(/<i class="dot (\w+)"/)?.[1]
}
