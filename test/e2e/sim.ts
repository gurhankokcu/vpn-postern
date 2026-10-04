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
  return sh('hub', 'mkdir /srv/postern && cp -r /mnt/postern/package.json /mnt/postern/src /srv/postern && chown -R 1001:1001 /srv/postern')
}

// install.sh asks on /dev/tty, so it runs under script, which gives it a terminal fed by the answers.
export function install(answers: string[], command = 'bash /mnt/postern/install.sh') {
  return sh('hub', `POSTERN_SOURCE=/srv/postern script -qec '${command}' /dev/null`, answers.map((answer) => `${answer}\n`).join(''))
}

export async function login(password: string) {
  const { out } = await sh('tablet', `${curl} -o /dev/null -D - --data-urlencode password='${password}' ${hub}/login`)
  return {
    status: Number(out.match(/^HTTP\/1\.1 (\d+)/)?.[1] ?? 0),
    cookie: out.match(/^set-cookie: (session=[^;]+)/im)?.[1] ?? '',
  }
}

export function page(path: string, cookie = '') {
  return output('tablet', `${curl} -H 'cookie: ${cookie}' ${hub}${path}`)
}
