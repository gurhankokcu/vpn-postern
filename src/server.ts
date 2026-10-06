import { createHash, X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:https'
import { join } from 'node:path'
import { clear, expiredCookie, fail, locked, sessionCookie, valid, verify } from './auth.ts'
import { dir, load, type Node } from './data.ts'
import { addDevice, listDevices, qr, removeDevice, showDevice } from './devices.ts'
import { field, fields } from './fields.ts'
import { joinScript } from './join.ts'
import { addNode, dropJoin, findJoin, removeNode } from './nodes.ts'
import { devicePage, loginPage, nodePage, nodesPage, notFoundPage } from './pages.ts'
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

function hostname(req: IncomingMessage) {
  return (req.headers.host ?? '').replace(/:\d+$/, '')
}

function home(req: IncomingMessage, message = '', nodeName = '') {
  const { nodes, joins } = load()
  return nodesPage({ nodes, joins, handshakes: handshakes(), host: req.headers.host ?? '', pin: pin(), message, nodeName })
}

function findNode(n: string | undefined) {
  return load().nodes.find((node) => node.n === Number(n))
}

async function nodeHome(node: Node, message = '', deviceName = '') {
  return nodePage({ node, devices: await listDevices(node), message, deviceName })
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
    const sshKey = readFileSync(join(dir, 'id_ed25519.pub'), 'utf8').trim()
    const script = joinScript(found, { host: hostname(req), publicKey: hubKey(), sshKey })
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
  const [, viewN] = route.match(/^GET \/nodes\/(\d+)$/) ?? []
  const viewing = findNode(viewN)
  if (viewing) {
    return send(res, 200, await nodeHome(viewing))
  }
  const [, addN] = route.match(/^POST \/nodes\/(\d+)\/devices$/) ?? []
  const adding = findNode(addN)
  if (adding) {
    const params = await form(req)
    const name = field(params, 'deviceName')
    if (name === null) {
      return send(res, 400, await nodeHome(adding, 'A device name is 1 to 32 letters, digits, - or _.', params.get('deviceName') ?? ''))
    }
    const result = await addDevice(adding, name, hostname(req))
    if (result === 'taken') {
      return send(res, 409, await nodeHome(adding, 'Another device on this node already has that name.', name))
    }
    if (result === 'full') {
      return send(res, 409, await nodeHome(adding, 'All 253 device addresses on this node are in use.', name))
    }
    if (result === 'offline') {
      return send(res, 503, nodePage({ node: adding, devices: null, deviceName: name }))
    }
    return redirect(res, `/nodes/${adding.n}/devices/${name}`)
  }
  const [, removeN, removeName = ''] = route.match(/^POST \/nodes\/(\d+)\/devices\/([^/]+)\/remove$/) ?? []
  const removing = fields.deviceName.test(removeName) ? findNode(removeN) : undefined
  if (removing) {
    const result = await removeDevice(removing, removeName)
    if (result === 'missing') {
      return send(res, 404, notFoundPage())
    }
    if (result === 'offline') {
      return send(res, 503, nodePage({ node: removing, devices: null }))
    }
    return redirect(res, `/nodes/${removing.n}`)
  }
  const [, showN, name = '', download] = route.match(/^GET \/nodes\/(\d+)\/devices\/([^/]+?)(\.conf)?$/) ?? []
  const showing = fields.deviceName.test(name) ? findNode(showN) : undefined
  if (showing) {
    const conf = await showDevice(showing, name)
    if (conf === 'missing') {
      return send(res, 404, notFoundPage())
    }
    if (download && conf === 'offline') {
      return send(res, 503, `${showing.name} is offline.\n`, 'text/plain')
    }
    if (download) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="${name}.conf"` })
      return res.end(conf)
    }
    return send(res, 200, devicePage({ node: showing, name, svg: conf === 'offline' ? null : qr(conf) }))
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
