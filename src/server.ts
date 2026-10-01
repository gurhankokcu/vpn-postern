import { readFileSync } from 'node:fs'
import { createServer } from 'node:https'
import { join } from 'node:path'

const dir = process.env.POSTERN_DIR ?? '/var/lib/postern'

const tls = {
  key: readFileSync(join(dir, 'tls.key')),
  cert: readFileSync(join(dir, 'tls.crt')),
}

createServer(tls, (_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('VPN Postern\n')
}).listen(8443)
