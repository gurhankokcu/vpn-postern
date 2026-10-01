import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { dir } from './data.ts'

execFileSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650', '-subj', '/CN=postern',
  '-keyout', join(dir, 'tls.key'),
  '-out', join(dir, 'tls.crt'),
], { stdio: 'inherit' })
