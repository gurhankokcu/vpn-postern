import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type Data = { password: string }

export const dir = process.env.POSTERN_DIR ?? '.dev'

mkdirSync(dir, { recursive: true })

const file = join(dir, 'data.json')

export function load(): Data {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { password: '' }
}

export function save(data: Data) {
  writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 })
  renameSync(`${file}.tmp`, file)
}
