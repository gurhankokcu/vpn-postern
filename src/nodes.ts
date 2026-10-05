import { load, save } from './data.ts'
import { addPeer, keypair } from './wg.ts'

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
  const { publicKey } = keypair()
  const node = { name, n, publicKey }
  addPeer(node)
  save({ ...data, nodes: [...data.nodes, node] })
  return 'added'
}
