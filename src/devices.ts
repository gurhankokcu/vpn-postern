import { execFileSync } from 'node:child_process'
import type { Node } from './data.ts'
import { ssh } from './ssh.ts'
import { keypair, publicKey } from './wg.ts'

export type Device = { name: string; x: number }

const server = '/etc/wireguard/wg0.conf'
const clients = '/etc/wireguard/clients'
const queues = new Map<number, Promise<unknown>>()

// wireguard-install, whose wg0.conf a node may keep, lists an IPv6 address after it.
const address = /^AllowedIPs = (?:.*[ ,])?10\.66\.66\.(\d+)\/32(?:,.*)?$/m

export function devices(conf: string): Device[] {
  return conf.split(/^### Client /m).slice(1).map((block) => ({
    name: block.split('\n')[0],
    x: Number(block.match(address)?.[1]),
  }))
}

export function freeX(conf: string) {
  const taken = new Set([...conf.matchAll(new RegExp(address, 'gm'))].map((match) => Number(match[1])))
  for (let x = 2; x <= 254; x++) {
    if (!taken.has(x)) {
      return x
    }
  }
  return null
}

export function peer(name: string, key: string, x: number) {
  return `
### Client ${name}
[Peer]
PublicKey = ${key}
AllowedIPs = 10.66.66.${x}/32
`
}

export function clientConf(privateKey: string, x: number, serverKey: string, endpoint: string) {
  return `[Interface]
PrivateKey = ${privateKey}
Address = 10.66.66.${x}/32
DNS = 1.1.1.1, 1.0.0.1
MTU = 1340

[Peer]
PublicKey = ${serverKey}
Endpoint = ${endpoint}
AllowedIPs = 0.0.0.0/0, ::/0
`
}

export function withoutDevice(conf: string, name: string) {
  const lines = conf.split('\n')
  const start = lines.indexOf(`### Client ${name}`)
  if (start === -1) {
    return null
  }
  let end = start
  while (end < lines.length && lines[end] !== '') {
    end++
  }
  const from = lines[start - 1] === '' ? start - 1 : start
  return [...lines.slice(0, from), ...lines.slice(end)].join('\n')
}

// Each file lands whole through a rename, and syncconf applies the peers without
// dropping devices already connected.
export function addScript(name: string, conf: string, client: string) {
  return `set -eu
umask 077
mkdir -p ${clients}
cat > ${clients}/${name}.conf.tmp <<'EOF'
${client}EOF
cat > ${server}.tmp <<'EOF'
${conf}EOF
mv ${clients}/${name}.conf.tmp ${clients}/${name}.conf
mv ${server}.tmp ${server}
wg-quick strip wg0 | wg syncconf wg0 /dev/stdin
`
}

export function removeScript(name: string, conf: string) {
  return `set -eu
umask 077
cat > ${server}.tmp <<'EOF'
${conf}EOF
mv ${server}.tmp ${server}
rm -f ${clients}/${name}.conf
wg-quick strip wg0 | wg syncconf wg0 /dev/stdin
`
}

export function qr(text: string) {
  const svg = execFileSync('qrencode', ['-t', 'svg', '-o', '-'], { input: text, encoding: 'utf8' })
  return svg.slice(svg.indexOf('<svg'))
}

export async function listDevices(node: Node) {
  const { stdout, code } = await ssh(node, `cat ${server}`)
  return code === 0 ? devices(stdout) : null
}

// Changes to a node run one at a time, so each reads the wg0.conf the last one wrote.
function queued<T>(node: Node, change: () => Promise<T>) {
  const next = (queues.get(node.n) ?? Promise.resolve()).then(change, change)
  queues.set(node.n, next)
  return next
}

export function addDevice(node: Node, name: string, host: string) {
  return queued(node, () => add(node, name, host))
}

async function add(node: Node, name: string, host: string) {
  const read = await ssh(node, `cat ${server}`)
  if (read.code !== 0) {
    return 'offline'
  }
  const conf = read.stdout
  if (devices(conf).some((device) => device.name.toLowerCase() === name.toLowerCase())) {
    return 'taken'
  }
  const x = freeX(conf)
  if (x === null) {
    return 'full'
  }
  const serverKey = publicKey(conf.match(/^PrivateKey = (.+)$/m)?.[1] ?? '')
  const keys = keypair()
  const client = clientConf(keys.privateKey, x, serverKey, `${host}:${node.port}`)
  const write = await ssh(node, 'sh', addScript(name, conf + peer(name, keys.publicKey, x), client))
  return write.code === 0 ? 'added' : 'offline'
}

export function removeDevice(node: Node, name: string) {
  return queued(node, () => remove(node, name))
}

async function remove(node: Node, name: string) {
  const read = await ssh(node, `cat ${server}`)
  if (read.code !== 0) {
    return 'offline'
  }
  const conf = withoutDevice(read.stdout, name)
  if (conf === null) {
    return 'missing'
  }
  const write = await ssh(node, 'sh', removeScript(name, conf))
  return write.code === 0 ? 'removed' : 'offline'
}

export async function showDevice(node: Node, name: string) {
  const { stdout, code } = await ssh(node, `cat ${clients}/${name}.conf`)
  if (code === 255) {
    return 'offline'
  }
  return code === 0 ? stdout : 'missing'
}
