import { randomBytes } from 'node:crypto'
import { listenPort, live, load, save, type Node } from './data.ts'
import { rebuild } from './nft.ts'
import { forget } from './ssh.ts'
import { addPeer, hubPort, keypair, removePeer } from './wg.ts'

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

export function findJoin(token: string) {
  return live(load().joins).find((join) => join.token === token)
}

export function dropJoin(token: string) {
  const data = load()
  save({ ...data, joins: live(data.joins).filter((join) => join.token !== token) })
}
