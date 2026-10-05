import { execFileSync } from 'node:child_process'
import { address, type Node } from './data.ts'

function run(command: string, args: string[], input = '') {
  return execFileSync(command, args, { input, encoding: 'utf8' }).trim()
}

export function keypair() {
  const privateKey = run('wg', ['genkey'])
  return { privateKey, publicKey: run('wg', ['pubkey'], privateKey) }
}

export function hubKey() {
  return run('wg', ['show', 'postern0', 'public-key'])
}

export function handshakes() {
  const lines = run('wg', ['show', 'postern0', 'latest-handshakes']).split('\n').filter(Boolean)
  return new Map(lines.map((line) => {
    const [publicKey, seconds] = line.split('\t')
    return [publicKey, Number(seconds) * 1000]
  }))
}

export function addPeer(node: Node) {
  run('wg', ['set', 'postern0', 'peer', node.publicKey, 'allowed-ips', `${address(node)}/32`])
  run('wg-quick', ['save', 'postern0'])
}

export function removePeer(node: Node) {
  run('wg', ['set', 'postern0', 'peer', node.publicKey, 'remove'])
  run('wg-quick', ['save', 'postern0'])
}
