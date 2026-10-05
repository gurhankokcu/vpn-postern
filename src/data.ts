import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type Node = { name: string; n: number; publicKey: string }
export type Join = { token: string; n: number; privateKey: string; expires: number }
export type Data = { password: string; nodes: Node[]; joins: Join[] }

export const dir = process.env.POSTERN_DIR ?? '.dev'

mkdirSync(dir, { recursive: true })

const file = join(dir, 'data.json')

export function load(): Data {
  const stored = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  return { password: '', nodes: [], joins: [], ...stored }
}

export function save(data: Data) {
  writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 })
  renameSync(`${file}.tmp`, file)
}

export function address(node: Pick<Node, 'n'>) {
  return `10.99.0.${node.n}`
}

export function port(node: Pick<Node, 'n'>) {
  return 51820 + node.n
}
