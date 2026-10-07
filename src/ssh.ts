import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { address, dir, type Node } from './data.ts'

const knownHosts = join(dir, 'known_hosts')

// Given seconds, the whole call gives up after them, not only the connecting.
export function ssh(node: Node, command: string, input = '', seconds?: number) {
  const args = [
    '-i', join(dir, 'id_ed25519'),
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `UserKnownHostsFile=${knownHosts}`,
    '-o', 'HashKnownHosts=no',
    '-o', `ConnectTimeout=${seconds ?? 10}`,
    `root@${address(node)}`,
    command,
  ]
  return new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
    const child = execFile('ssh', args, { timeout: (seconds ?? 0) * 1000 }, (_, stdout, stderr) => {
      resolve({ stdout, stderr, code: child.exitCode ?? 255 })
    })
    child.stdin?.end(input)
  })
}

// A removed node's number goes to the next node added, which has a different host key.
export function forget(node: Node) {
  if (!existsSync(knownHosts)) {
    return
  }
  const lines = readFileSync(knownHosts, 'utf8').split('\n')
  writeFileSync(knownHosts, lines.filter((line) => !line.startsWith(`${address(node)} `)).join('\n'))
}
