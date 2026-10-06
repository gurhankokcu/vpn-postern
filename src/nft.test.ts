import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.POSTERN_DIR = mkdtempSync(join(tmpdir(), 'postern-'))
process.env.PATH = `${join(import.meta.dirname, '..', 'dev', 'bin')}:${process.env.PATH}`
const { save } = await import('./data.ts')
const { rebuild, ruleset } = await import('./nft.ts')

test('each node forwards its port on the hub to its wg0 port, 51820 + n, on its address', () => {
  assert.equal(ruleset([{ name: 'home', n: 2, port: 51822, publicKey: 'key' }, { name: 'work', n: 254, port: 443, publicKey: 'key' }]), `table inet postern
delete table inet postern
table inet postern {
  chain prerouting {
    type nat hook prerouting priority dstnat; policy accept;
    udp dport 51822 dnat ip to 10.99.0.2:51822
    udp dport 443 dnat ip to 10.99.0.254:52074
  }
  chain postrouting {
    type nat hook postrouting priority srcnat; policy accept;
    oifname "postern0" masquerade
  }
}
`)
})

test('with no nodes, the table has no forwards but still masquerades', () => {
  const table = ruleset([])
  assert.ok(!table.includes('dnat'))
  assert.match(table, /oifname "postern0" masquerade/)
})

test('rebuild loads the ruleset made from data.json', () => {
  const nodes = [{ name: 'home', n: 2, port: 51822, publicKey: 'key' }]
  save({ password: '', nodes, joins: [] })
  rebuild()
  assert.equal(readFileSync(join(process.env.POSTERN_DIR!, 'nft'), 'utf8'), ruleset(nodes))
})
