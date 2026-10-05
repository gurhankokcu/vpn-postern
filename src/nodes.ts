import { load, save } from './data.ts'

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
  const node = { name, n }
  save({ ...data, nodes: [...data.nodes, node] })
  return 'added'
}
