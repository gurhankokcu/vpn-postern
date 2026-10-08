import { execFileSync } from 'node:child_process'
import { address, type Node } from './data.ts'

const onlineMs = 3 * 60 * 1000

function run(command: string, args: string[], input = '') {
  return execFileSync(command, args, { input, encoding: 'utf8' }).trim()
}

export function publicKey(privateKey: string) {
  return run('wg', ['pubkey'], privateKey)
}

export function keypair() {
  const privateKey = run('wg', ['genkey'])
  return { privateKey, publicKey: publicKey(privateKey) }
}

export function hubKey() {
  return run('wg', ['show', 'postern0', 'public-key'])
}

export function hubPort() {
  return Number(run('wg', ['show', 'postern0', 'listen-port']))
}

// The hub takes the port for a moment and gives it back, as another service may hold it.
export function hubPortFree(port: number) {
  const hub = hubPort()
  try {
    run('wg', ['set', 'postern0', 'listen-port', String(port)])
  } catch {
    return false
  }
  run('wg', ['set', 'postern0', 'listen-port', String(hub)])
  return true
}

export function setHubPort(port: number) {
  run('wg', ['set', 'postern0', 'listen-port', String(port)])
  run('wg-quick', ['save', 'postern0'])
}

export function latestHandshakes(text: string) {
  const lines = text.split('\n').filter(Boolean)
  return new Map(lines.map((line) => {
    const [publicKey, seconds] = line.split('\t')
    return [publicKey, Number(seconds) * 1000]
  }))
}

export function handshakes() {
  return latestHandshakes(run('wg', ['show', 'postern0', 'latest-handshakes']))
}

// A peer is online when it has shaken hands in the last 3 minutes.
export function recent(handshake = 0) {
  return Date.now() - handshake < onlineMs
}

export function online(nodes: Node[]) {
  const seen = handshakes()
  return new Set(nodes.filter((node) => recent(seen.get(node.publicKey))).map((node) => node.n))
}

export function addPeer(node: Node) {
  run('wg', ['set', 'postern0', 'peer', node.publicKey, 'allowed-ips', `${address(node)}/32`])
  run('wg-quick', ['save', 'postern0'])
}

export function removePeer(node: Node) {
  run('wg', ['set', 'postern0', 'peer', node.publicKey, 'remove'])
  run('wg-quick', ['save', 'postern0'])
}
