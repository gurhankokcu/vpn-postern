import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, test } from 'node:test'

process.env.POSTERN_DIR = mkdtempSync(join(tmpdir(), 'postern-'))
process.env.PATH = `${join(import.meta.dirname, '..', 'dev', 'bin')}:${process.env.PATH}`
const { forget, ssh } = await import('./ssh.ts')
const dir = process.env.POSTERN_DIR
const node = { name: 'home', n: 2, port: 51822, publicKey: 'key' }

beforeEach(() => {
  for (const file of ['ssh.log', 'ssh.out', 'ssh.code', 'ssh.hang', 'known_hosts']) {
    rmSync(join(dir, file), { force: true })
  }
})

test('ssh runs the command as root on the node with the hub key and stdin', async () => {
  await ssh(node, 'cat > /tmp/file', 'hello\n')
  assert.equal(readFileSync(join(dir, 'ssh.log'), 'utf8'), `ssh -i ${dir}/id_ed25519 -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${dir}/known_hosts -o HashKnownHosts=no -o ControlMaster=auto -o ControlPath=${dir}/ssh-10.99.0.2 -o ControlPersist=10m -o ServerAliveInterval=5 -o ServerAliveCountMax=2 -o ConnectTimeout=10 root@10.99.0.2 cat > /tmp/file
hello
`)
})

test('ssh returns what the node printed and exit code 0', async () => {
  writeFileSync(join(dir, 'ssh.out'), 'home-pi\n')
  assert.deepEqual(await ssh(node, 'hostname'), { stdout: 'home-pi\n', stderr: '', code: 0 })
})

test('ssh returns the exit code when it fails', async () => {
  writeFileSync(join(dir, 'ssh.code'), '255')
  assert.equal((await ssh(node, 'hostname')).code, 255)
})

test('ssh given seconds connects within them and gives up on a node that stops answering', async () => {
  writeFileSync(join(dir, 'ssh.hang'), '')
  const start = Date.now()
  assert.equal((await ssh(node, 'hostname', '', 1)).code, 255)
  assert.ok(Date.now() - start < 5000)
  assert.match(readFileSync(join(dir, 'ssh.log'), 'utf8'), /-o ConnectTimeout=1 root@/)
})

test('forget drops only the node\'s host keys', () => {
  writeFileSync(join(dir, 'known_hosts'), '10.99.0.2 ssh-ed25519 AAAAold\n10.99.0.20 ssh-ed25519 AAAAother\n10.99.0.2 ecdsa-sha2-nistp256 AAAAold\n')
  forget(node)
  assert.equal(readFileSync(join(dir, 'known_hosts'), 'utf8'), '10.99.0.20 ssh-ed25519 AAAAother\n')
})

test('forget closes only the node\'s shared connection', () => {
  writeFileSync(join(dir, 'ssh-10.99.0.2'), '')
  writeFileSync(join(dir, 'ssh-10.99.0.20'), '')
  forget(node)
  assert.equal(existsSync(join(dir, 'ssh-10.99.0.2')), false)
  assert.equal(existsSync(join(dir, 'ssh-10.99.0.20')), true)
})

test('forget does nothing before the hub has met any node', () => {
  forget(node)
  assert.equal(existsSync(join(dir, 'known_hosts')), false)
})
