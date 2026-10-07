import { createHash, X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:https'
import { join } from 'node:path'
import { clear, expiredCookie, fail, locked, sessionCookie, valid, verify } from './auth.ts'
import { dir, live, load } from './data.ts'
import { addDevice, listDevices, qr, removeDevice, showDevice } from './devices.ts'
import { field, fields } from './fields.ts'
import { joinScript } from './join.ts'
import { addNode, dropJoin, findJoin, nextPort, removeNode } from './nodes.ts'
import { addDeviceModal, addNodeModal, deviceModal, joinModal, loginPage, notFoundPage, treePage } from './pages.ts'
import { hubKey, hubPort, online } from './wg.ts'

const css = readFileSync(join(import.meta.dirname, 'style.css'))
const script = readFileSync(join(import.meta.dirname, 'script.js'))

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

function findNode(n: string | undefined) {
  return load().nodes.find((node) => node.n === Number(n))
}

// Only nodes seen in the last 3 minutes are asked for their devices, all at once.
async function tree(modal = '', message = '') {
  const { nodes, joins } = load()
  const up = online(nodes)
  const lists = await Promise.all(nodes.map((node) => (up.has(node.n) ? listDevices(node) : null)))
  const devices = new Map(nodes.map((node, i) => [node.n, lists[i]]))
  return treePage({ hubPort: hubPort(), nodes, joins: live(joins), devices, message, modal })
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const ip = req.socket.remoteAddress ?? ''
  const route = `${req.method} ${req.url?.split('?')[0]}`

  if (route === 'GET /style.css') {
    return send(res, 200, css, 'text/css')
  }
  if (route === 'GET /script.js') {
    return send(res, 200, script, 'text/javascript')
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
    const node = found && findNode(String(found.n))
    if (!found || !node) {
      return send(res, 404, 'This join command is used or expired.\n', 'text/plain')
    }
    const sshKey = readFileSync(join(dir, 'id_ed25519.pub'), 'utf8').trim()
    const script = joinScript(found, node.port, { host: hostname(req), port: hubPort(), publicKey: hubKey(), sshKey })
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
    return send(res, 200, await tree())
  }
  if (route === 'GET /nodes/new') {
    return send(res, 200, await tree(addNodeModal(nextPort())))
  }
  if (route === 'POST /nodes') {
    const params = await form(req)
    const name = field(params, 'nodeName')
    const port = field(params, 'port')
    const again = (status: number, message: string) => tree(addNodeModal(params.get('port') ?? '', message, params.get('nodeName') ?? '')).then((html) => send(res, status, html))
    if (name === null) {
      return again(400, 'A node name is 1 to 32 letters, digits, - or _, with single spaces between words.')
    }
    const result = port === null ? 'port-invalid' : addNode(name, Number(port))
    if (result === 'port-invalid') {
      return again(400, 'A port is a whole number from 1 to 65535.')
    }
    if (result === 'port-taken') {
      return again(409, 'The hub or another node already uses that port.')
    }
    if (result === 'taken') {
      return again(409, 'Another node already has that name.')
    }
    if (result === 'full') {
      return again(409, 'All 253 node addresses are in use.')
    }
    return redirect(res, `/nodes/${load().nodes.find((node) => node.name === name)?.n}/join`)
  }
  const remove = route.match(/^POST \/nodes\/(\d+)\/remove$/)
  if (remove) {
    if (removeNode(Number(remove[1])) === 'missing') {
      return send(res, 404, notFoundPage())
    }
    return redirect(res, '/')
  }
  const [, joinN] = route.match(/^GET \/nodes\/(\d+)\/join$/) ?? []
  const joining = findNode(joinN)
  const waiting = joining && live(load().joins).find((join) => join.n === joining.n)
  if (joining && waiting) {
    const command = `curl -fsSk --pinnedpubkey sha256//${pin()} https://${req.headers.host ?? ''}/join/${waiting.token} | sudo sh`
    return send(res, 200, await tree(joinModal(joining, command, waiting.expires)))
  }
  const [, openN] = route.match(/^GET \/nodes\/(\d+)\/new-device$/) ?? []
  const opening = findNode(openN)
  if (opening) {
    return send(res, 200, await tree(addDeviceModal(opening)))
  }
  const [, addN] = route.match(/^POST \/nodes\/(\d+)\/devices$/) ?? []
  const adding = findNode(addN)
  if (adding) {
    const params = await form(req)
    const name = field(params, 'deviceName')
    const again = (status: number, message: string) => tree(addDeviceModal(adding, message, params.get('deviceName') ?? '')).then((html) => send(res, status, html))
    if (name === null) {
      return again(400, 'A device name is 1 to 32 letters, digits, - or _.')
    }
    const result = await addDevice(adding, name, hostname(req))
    if (result === 'taken') {
      return again(409, 'Another device on this node already has that name.')
    }
    if (result === 'full') {
      return again(409, 'All 253 device addresses on this node are in use.')
    }
    if (result === 'offline') {
      return again(503, `${adding.name} is offline.`)
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
      return send(res, 503, await tree('', `${removing.name} is offline.`))
    }
    return redirect(res, '/')
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
    return send(res, 200, await tree(conf === 'offline' ? deviceModal(showing, name, null) : deviceModal(showing, name, conf, qr(conf))))
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
