import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:https'
import { join } from 'node:path'
import { clear, expiredCookie, fail, locked, sessionCookie, valid, verify } from './auth.ts'
import { dir, load } from './data.ts'
import { loginPage, nodesPage, notFoundPage } from './pages.ts'

const tls = {
  key: readFileSync(join(dir, 'tls.key')),
  cert: readFileSync(join(dir, 'tls.crt')),
}

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
    if (!verify((await form(req)).get('password') ?? '', load().password)) {
      fail(ip)
      return send(res, 401, loginPage('Wrong password.'))
    }
    clear(ip)
    return redirect(res, '/', sessionCookie())
  }

  if (!valid(req.headers.cookie)) {
    return redirect(res, '/login')
  }

  if (route === 'POST /logout') {
    return redirect(res, '/login', expiredCookie())
  }
  if (route === 'GET /') {
    return send(res, 200, nodesPage(load().nodes))
  }
  send(res, 404, notFoundPage())
}

createServer(tls, (req, res) => {
  handle(req, res).catch((error) => {
    console.error(error)
    res.destroy()
  })
}).listen(8443)
