import { randomBytes } from 'node:crypto'
import { live, load, save } from './data.ts'
import { rebuild } from './nft.ts'
import { addPeer, keypair, removePeer } from './wg.ts'

const joinMs = 60 * 60 * 1000

export function addNode(name: string) {
  const data = load()
  if (data.nodes.some((node) => node.name.toLowerCase() === name.toLowerCase())) {
    return 'taken'
  }
  let n = 2
  while (data.nodes.some((node) => node.n === n)) {
    n++
  }
  if (n > 254) {
    return 'full'
  }
  const { privateKey, publicKey } = keypair()
  const node = { name, n, publicKey }
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
