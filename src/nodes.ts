import { randomBytes } from 'node:crypto'
import { load, save, type Join } from './data.ts'
import { addPeer, keypair } from './wg.ts'

const joinMs = 60 * 60 * 1000

function live(joins: Join[]) {
  return joins.filter((join) => join.expires > Date.now())
}

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
  return 'added'
}

export function findJoin(token: string) {
  return live(load().joins).find((join) => join.token === token)
}

export function dropJoin(token: string) {
  const data = load()
  save({ ...data, joins: live(data.joins).filter((join) => join.token !== token) })
}
