import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:https'
import { join } from 'node:path'
import { clear, expiredCookie, fail, locked, sessionCookie, valid, verify } from './auth.ts'
import { dir, load } from './data.ts'

const tls = {
  key: readFileSync(join(dir, 'tls.key')),
  cert: readFileSync(join(dir, 'tls.crt')),
}

function page(body: string) {
  return `<!doctype html><meta charset="utf-8"><title>VPN Postern</title>${body}`
}

function loginPage(message = '') {
  return page(`<form method="post" action="/login">${message && `<p>${message}</p>`}<input type="password" name="password" autofocus><button>Log in</button></form>`)
}

function homePage() {
  return page(`<p>Logged in</p><form method="post" action="/logout"><button>Log out</button></form>`)
}

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

function send(res: ServerResponse, status: number, html: string) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }).end(html)
}

function redirect(res: ServerResponse, location: string, cookie?: string) {
  res.writeHead(303, cookie ? { location, 'set-cookie': cookie } : { location }).end()
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const ip = req.socket.remoteAddress ?? ''
  const route = `${req.method} ${req.url?.split('?')[0]}`

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
    return send(res, 200, homePage())
  }
  send(res, 404, page('<p>Not found.</p>'))
}

createServer(tls, (req, res) => {
  handle(req, res).catch((error) => {
    console.error(error)
    res.destroy()
  })
}).listen(8443)
