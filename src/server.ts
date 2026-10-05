import { createHash, X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:https'
import { join } from 'node:path'
import { clear, expiredCookie, fail, locked, sessionCookie, valid, verify } from './auth.ts'
import { dir, load } from './data.ts'
import { field } from './fields.ts'
import { joinScript } from './join.ts'
import { addNode, dropJoin, findJoin, removeNode } from './nodes.ts'
import { loginPage, nodesPage, notFoundPage } from './pages.ts'
import { handshakes, hubKey } from './wg.ts'

const css = readFileSync(join(import.meta.dirname, 'style.css'))

async function form(req: IncomingMessage) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 4096) {
      throw new Error('Request body too large.')
    }
  }
  return new URLSearchParams(body)
}

function send(res: ServerResponse, status: number, body: string | Buffer, type = 'text/html') {
  res.writeHead(status, { 'content-type': `${type}; charset=utf-8` }).end(body)
}

function redirect(res: ServerResponse, location: string, cookie?: string) {
  res.writeHead(303, cookie ? { location, 'set-cookie': cookie } : { location }).end()
}

function pin() {
  const key = new X509Certificate(readFileSync(join(dir, 'tls.crt'))).publicKey.export({ type: 'spki', format: 'der' })
  return createHash('sha256').update(key).digest('base64')
}

function home(req: IncomingMessage, message = '', nodeName = '') {
  const { nodes, joins } = load()
  return nodesPage({ nodes, joins, handshakes: handshakes(), host: req.headers.host ?? '', pin: pin(), message, nodeName })
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const ip = req.socket.remoteAddress ?? ''
  const route = `${req.method} ${req.url?.split('?')[0]}`

  if (route === 'GET /style.css') {
    return send(res, 200, css, 'text/css')
  }
  if (route === 'GET /login') {
    return send(res, 200, loginPage())
  }
  if (route === 'POST /login') {
    if (locked(ip)) {
      return send(res, 429, loginPage('Too many attempts. Try again later.'))
    }
    const password = field(await form(req), 'password')
    if (password === null || !verify(password, load().password)) {
      fail(ip)
      return send(res, 401, loginPage('Wrong password.'))
    }
    clear(ip)
    return redirect(res, '/', sessionCookie())
  }
  if (route.startsWith('GET /join/')) {
    const token = route.slice('GET /join/'.length)
    const found = findJoin(token)
    if (!found) {
      return send(res, 404, 'This join command is used or expired.\n', 'text/plain')
    }
    const host = (req.headers.host ?? '').replace(/:\d+$/, '')
    const sshKey = readFileSync(join(dir, 'id_ed25519.pub'), 'utf8').trim()
    const script = joinScript(found, { host, publicKey: hubKey(), sshKey })
    dropJoin(token)
    return send(res, 200, script, 'text/plain')
  }

  if (!valid(req.headers.cookie)) {
    return redirect(res, '/login')
  }

  if (route === 'POST /logout') {
    return redirect(res, '/login', expiredCookie())
  }
  if (route === 'GET /') {
    return send(res, 200, home(req))
  }
  if (route === 'POST /nodes') {
    const params = await form(req)
    const name = field(params, 'nodeName')
    if (name === null) {
      return send(res, 400, home(req, 'A node name is 1 to 32 letters, digits, - or _, with single spaces between words.', params.get('nodeName') ?? ''))
    }
    const result = addNode(name)
    if (result === 'taken') {
      return send(res, 409, home(req, 'Another node already has that name.', name))
    }
    if (result === 'full') {
      return send(res, 409, home(req, 'All 253 node addresses are in use.', name))
    }
    return redirect(res, '/')
  }
  const remove = route.match(/^POST \/nodes\/(\d+)\/remove$/)
  if (remove) {
    if (removeNode(Number(remove[1])) === 'missing') {
      return send(res, 404, notFoundPage())
    }
    return redirect(res, '/')
  }
  send(res, 404, notFoundPage())
}

export function listener(req: IncomingMessage, res: ServerResponse) {
  handle(req, res).catch((error) => {
    console.error(error)
    res.destroy()
  })
}

if (import.meta.main) {
  const tls = {
    key: readFileSync(join(dir, 'tls.key')),
    cert: readFileSync(join(dir, 'tls.crt')),
  }
  createServer(tls, listener).listen(8443)
}
