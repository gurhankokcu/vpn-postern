import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { address, dir, load, port, type Node } from './data.ts'

const file = join(dir, 'postern.nft')

// Declaring the table first lets the delete succeed when it does not exist yet;
// nft applies the file as one transaction, so forwards never drop in between.
export function ruleset(nodes: Node[]) {
  const forwards = nodes.map((node) => `    udp dport ${port(node)} dnat ip to ${address(node)}:${port(node)}\n`).join('')
  return `table inet postern
delete table inet postern
table inet postern {
  chain prerouting {
    type nat hook prerouting priority dstnat; policy accept;
${forwards}  }
  chain postrouting {
    type nat hook postrouting priority srcnat; policy accept;
    oifname "postern0" masquerade
  }
}
`
}

// nft 1.0.9, as on Ubuntu 24.04, refuses a pipe as its input, so the ruleset goes through a file.
export function rebuild() {
  writeFileSync(file, ruleset(load().nodes))
  execFileSync('nft', ['-f', file])
}

if (import.meta.main) {
  rebuild()
}
