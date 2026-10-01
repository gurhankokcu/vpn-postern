import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type Node = { name: string; n: number }
export type Data = { password: string; nodes: Node[] }

export const dir = process.env.POSTERN_DIR ?? '.dev'

mkdirSync(dir, { recursive: true })

const file = join(dir, 'data.json')

export function load(): Data {
  const stored = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  return { password: '', nodes: [], ...stored }
}

export function save(data: Data) {
  writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 })
  renameSync(`${file}.tmp`, file)
}

export function address(node: Node) {
  return `10.99.0.${node.n}`
}

export function port(node: Node) {
  return 51820 + node.n
}
