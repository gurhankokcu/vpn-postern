import { randomBytes } from 'node:crypto'
import { listenPort, live, load, save, type Node } from './data.ts'
import { movePort } from './devices.ts'
import { rebuild } from './nft.ts'
import { forget, ssh } from './ssh.ts'
import { addPeer, hubPort, hubPortFree, keypair, online, removePeer, setHubPort } from './wg.ts'

const joinMs = 60 * 60 * 1000

function inRange(port: number) {
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

export function portProblem(hub: number, nodes: Node[], port: number) {
  if (!inRange(port)) {
    return 'port-invalid'
  }
  return port === hub || nodes.some((node) => node.port === port) ? 'port-taken' : null
}

function defaultPort(hub: number, nodes: Node[], n: number) {
  let port = listenPort({ n })
  while (portProblem(hub, nodes, port)) {
    port++
  }
  return port
}

function nextN(nodes: Node[]) {
  let n = 2
  while (nodes.some((node) => node.n === n)) {
    n++
  }
  return n
}

export function nextPort() {
  const { nodes } = load()
  return defaultPort(hubPort(), nodes, nextN(nodes))
}

export function addNode(name: string, chosen?: number) {
  const data = load()
  if (data.nodes.some((node) => node.name.toLowerCase() === name.toLowerCase())) {
    return 'taken'
  }
  const n = nextN(data.nodes)
  if (n > 254) {
    return 'full'
  }
  const hub = hubPort()
  const port = chosen ?? defaultPort(hub, data.nodes, n)
  const problem = portProblem(hub, data.nodes, port)
  if (problem) {
    return problem
  }
  const { privateKey, publicKey } = keypair()
  const node = { name, n, port, publicKey }
  const join = { token: randomBytes(32).toString('hex'), n, privateKey, expires: Date.now() + joinMs }
  addPeer(node)
  save({ ...data, nodes: [...data.nodes, node], joins: [...live(data.joins), join] })
  rebuild()
  return 'added'
}

export function removeNode(n: number) {
  const data = load()
  const node = data.nodes.find((other) => other.n === n)
  if (!node) {
    return 'missing'
  }
  removePeer(node)
  forget(node)
  save({ ...data, nodes: data.nodes.filter((other) => other.n !== n), joins: live(data.joins).filter((join) => join.n !== n) })
  rebuild()
  return 'removed'
}

export function unjoined(n: number) {
  return live(load().joins).some((join) => join.n === n)
}

// The devices' configs move first, so a node that cannot be reached keeps its old port.
// A node still waiting to join has none, and reads its port when it joins.
export async function changePort(n: number, port: number) {
  const data = load()
  const node = data.nodes.find((other) => other.n === n)
  if (!node) {
    return 'missing'
  }
  const problem = portProblem(hubPort(), data.nodes.filter((other) => other.n !== n), port)
  if (problem) {
    return problem
  }
  if (!unjoined(n) && await movePort(node, port) === 'offline') {
    return 'offline'
  }
  const fresh = load()
  save({ ...fresh, nodes: fresh.nodes.map((other) => (other.n === n ? { ...other, port } : other)) })
  rebuild()
  return 'changed'
}

const postern0 = '/etc/wireguard/postern0.conf'

export function stageScript(port: number) {
  return `set -eu
umask 077
sed '/^Endpoint = /s/:[0-9]*$/:${port}/' ${postern0} > ${postern0}.next
`
}

export const unstageScript = `rm -f ${postern0}.next
`

// The node applies the new port on a timer, after this call is over and the hub has moved.
export const switchScript = `set -eu
mv ${postern0}.next ${postern0}
systemd-run --quiet --on-active=3 sh -c 'wg-quick strip postern0 | wg syncconf postern0 /dev/stdin'
`

// A node that has joined dials the hub's port, so it must be reached to move with it.
export function offlineNodes() {
  const { nodes } = load()
  const up = online(nodes)
  return nodes.filter((node) => !up.has(node.n) && !unjoined(node.n))
}

// Every node stages the new port first, so one that cannot be reached leaves them all on the old.
export async function changeHubPort(port: number) {
  const hub = hubPort()
  if (port === hub) {
    return 'changed'
  }
  const { nodes } = load()
  const problem = portProblem(hub, nodes, port)
  if (problem) {
    return problem
  }
  const offline = offlineNodes()
  if (offline.length) {
    return offline
  }
  if (!hubPortFree(port)) {
    return 'port-busy'
  }
  const joined = nodes.filter((node) => !unjoined(node.n))
  const staged = await Promise.all(joined.map((node) => ssh(node, 'sh', stageScript(port))))
  const failed = joined.filter((_, i) => staged[i].code !== 0)
  if (failed.length) {
    await Promise.all(joined.map((node) => ssh(node, 'sh', unstageScript)))
    return failed
  }
  await Promise.all(joined.map((node) => ssh(node, 'sh', switchScript)))
  setHubPort(port)
  return 'changed'
}

export function findJoin(token: string) {
  return live(load().joins).find((join) => join.token === token)
}

export function dropJoin(token: string) {
  const data = load()
  save({ ...data, joins: live(data.joins).filter((join) => join.token !== token) })
}
