import { address, type Join, type Node } from './data.ts'
import type { Device } from './devices.ts'

const mark = `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
<path d="M4 28V11l12-7 12 7v17" stroke="url(#g)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M12 28v-8a4 4 0 0 1 8 0v8" stroke="url(#g)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="16" cy="21" r="1.5" fill="#37d4c4"/>
<defs><linearGradient id="g" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
<stop stop-color="#37d4c4"/><stop offset="1" stop-color="#6f8ff8"/>
</linearGradient></defs>
</svg>`

const brand = `<div class="brand">${mark}<b>VPN <span>Postern</span></b></div>`

// Lucide icons (https://lucide.dev), ISC licence, Copyright (c) 2026 Lucide Icons and Contributors.
const icons = {
  add: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  download: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  join: '<path d="M12 19h8"/><path d="m4 17 6-6-6-6"/>',
  remove: '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  show: '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>',
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

function icon(name: keyof typeof icons) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`
}

function link(href: string, label: string, name: keyof typeof icons) {
  return `<a class="btn ghost act" href="${href}" aria-label="${label}">${icon(name)}</a>`
}

function removeButton(action: string, question: string) {
  return `<form method="post" action="${action}" data-confirm="${escapeHtml(question)}" onsubmit="return confirm(this.dataset.confirm)"><button class="btn ghost act danger" aria-label="Remove">${icon('remove')}</button></form>`
}

function code(text: string, tools = '') {
  return `<div class="code"><pre tabindex="0">${escapeHtml(text)}</pre><div class="tools"><button type="button" class="btn ghost act" aria-label="Copy" data-copy>${icon('copy')}</button>${tools}</div></div>`
}

function page(title: string, body: string, className = '') {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · VPN Postern</title>
<link rel="stylesheet" href="/style.css">
<script src="/script.js" defer></script>
</head>
<body${className && ` class="${className}"`}>
${body}
</body>
</html>`
}

function layout(title: string, content: string) {
  return page(title, `<header class="bar">
${brand}
<form method="post" action="/logout"><button class="btn ghost">Log out</button></form>
</header>
<main>${content}</main>`)
}

export function loginPage(message = '') {
  return page('Log in', `<main>
${brand}
<p class="tag">The back gate to your home network</p>
<form class="card" method="post" action="/login">
${message && `<div class="note">${message}</div>`}
<label>Password<span class="field"><input name="password" type="password" autocomplete="current-password" autofocus required></span></label>
<button class="btn primary">Log in</button>
</form>
</main>`, 'login')
}

export type TreeView = {
  hubPort: number
  nodes: Node[]
  joins: Join[]
  devices: Map<number, Device[] | null>
  message?: string
  modal?: string
}

// Each row draws its own share of the tree's lines: a pass for every ancestor with more
// children below, then a tee, or an elbow for the last child.
function guides(trail: string[]) {
  return trail.map((kind) => `<i class="guide ${kind}"></i>`).join('')
}

function dot(status: string) {
  return `<i class="dot ${status}" role="img" aria-label="${status}"></i>`
}

function row(className: string, trail: string[], label: string, address = '', port = '', acts = '') {
  return `<tr${className && ` class="${className}"`}>
<td class="name"><div class="cell">${guides(trail)}<span class="label">${label}</span></div></td>
<td class="mono address">${address}</td>
<td class="mono port">${port}</td>
<td class="acts">${acts}</td>
</tr>`
}

function aside(trail: string[], text: string, extra = '') {
  return `<tr class="aside"><td class="name" colspan="4"><div class="cell">${guides(trail)}<span class="label">${text}</span>${extra}</div></td></tr>`
}

function removeNodeQuestion(node: Node, devices: Device[] | null | undefined) {
  if (!devices) {
    return `Remove ${node.name}? It and its devices lose their connection.`
  }
  if (!devices.length) {
    return `Remove ${node.name}? It loses its connection.`
  }
  return `Remove ${node.name}? It and its ${devices.length} device${devices.length === 1 ? '' : 's'} lose their connection.`
}

export function treePage({ hubPort, nodes, joins, devices, message = '', modal = '' }: TreeView) {
  const waiting = new Set(joins.map((join) => join.n))
  const rows = [row('hub', [], `${dot('online')}<b>Hub</b>`, '10.99.0.1', `<span class="value">${hubPort}${link('/port', 'Change port', 'edit')}</span>`, link('/new-node', 'Add node', 'add'))]
  if (!nodes.length) {
    rows.push(aside(['elbow'], 'No nodes yet. Add one for each home network to reach.', '<a class="btn primary first" href="/new-node">Add your first node</a>'))
  }
  nodes.forEach((node, i) => {
    const last = i === nodes.length - 1
    const pass = last ? 'blank' : 'pass'
    const list = devices.get(node.n)
    const status = list ? 'online' : 'offline'
    const acts = (waiting.has(node.n) ? link(`/nodes/${node.n}/join`, 'Join command', 'join') : '')
      + (list ? link(`/nodes/${node.n}/new-device`, 'Add device', 'add') : '')
      + removeButton(`/nodes/${node.n}/remove`, removeNodeQuestion(node, list))
    rows.push(row(list ? '' : 'faint', [last ? 'elbow' : 'tee'], `${dot(status)}<b>${escapeHtml(node.name)}</b>`, address(node), `<span class="value">${node.port}${link(`/nodes/${node.n}/port`, 'Change port', 'edit')}</span>`, acts))
    if (!list) {
      rows.push(aside([pass, 'elbow'], waiting.has(node.n) ? 'Waiting to join. Its devices show here once it does.' : 'Offline. Its devices show here once it is back.'))
    } else if (!list.length) {
      rows.push(aside([pass, 'elbow'], 'No devices yet.'))
    }
    list?.forEach((device, j) => {
      const href = `/nodes/${node.n}/devices/${encodeURIComponent(device.name)}`
      const acts = link(href, 'Show', 'show') + removeButton(`${href}/remove`, `Remove ${device.name}? It stops connecting until you add it again and scan its new QR code.`)
      rows.push(row('', [pass, j === list.length - 1 ? 'elbow' : 'tee'], `<b>${escapeHtml(device.name)}</b>`, `10.66.66.${device.x}`, '', acts))
    })
  })

  return layout('Nodes', `${message && `<div class="note">${message}</div>\n`}<section class="card"><table class="tree">
<thead><tr><th>Name</th><th class="address">Address</th><th class="port">Port</th><th></th></tr></thead>
<tbody>
${rows.join('\n')}
</tbody>
</table></section>${modal}`)
}

function modal(title: string, body: string, size = '') {
  return `
<dialog open${size && ` class="${size}"`} aria-labelledby="modal-title">
<div class="card-head"><h2 id="modal-title">${title}</h2>${link('/', 'Close', 'close')}</div>
${body}
</dialog>`
}

function buttons(label: string) {
  return `<div class="buttons"><a class="btn ghost" href="/">Cancel</a><button class="btn primary">${label}</button></div>`
}

export function addNodeModal(port: number | string, message = '', name = '') {
  return modal('Add node', `<form class="form" method="post" action="/nodes">
${message && `<div class="note">${message}</div>`}
<label>Name<span class="field"><input name="nodeName" value="${escapeHtml(name)}" autocomplete="off" autofocus required></span><small>1 to 32 letters, digits, - or _, with single spaces between words.</small></label>
<label>Port<span class="field"><input name="port" value="${escapeHtml(String(port))}" inputmode="numeric" autocomplete="off" required></span><small>The UDP port on the hub that this node's devices dial.</small></label>
${buttons('Add node')}
</form>`)
}

export function joinModal(node: Node, command: string, expires: number) {
  const minutes = Math.max(1, Math.round((expires - Date.now()) / 60_000))
  return modal(`Join ${escapeHtml(node.name)}`, `<div class="modal-body">
<p>Run this on ${escapeHtml(node.name)} as root. It works once, within the hour.</p>
${code(command)}
<small>Expires in ${minutes} minute${minutes === 1 ? '' : 's'}.</small>
</div>`, 'wide')
}

export function addDeviceModal(node: Node, message = '', name = '') {
  return modal(`Add a device to ${escapeHtml(node.name)}`, `<form class="form" method="post" action="/nodes/${node.n}/devices">
${message && `<div class="note">${message}</div>`}
<label>Name<span class="field"><input name="deviceName" value="${escapeHtml(name)}" autocomplete="off" autofocus required></span><small>1 to 32 letters, digits, - or _. No spaces.</small></label>
${buttons('Add device')}
</form>`)
}

export function deviceModal(node: Node, name: string, conf: string | null, svg = '') {
  const title = `${escapeHtml(name)} <span class="pill">${escapeHtml(node.name)}</span>`
  if (conf === null) {
    return modal(title, `<div class="modal-body"><div class="note">${escapeHtml(node.name)} is offline. Its QR code shows here once it is back.</div></div>`)
  }
  const download = `<a class="btn ghost act" href="/nodes/${node.n}/devices/${encodeURIComponent(name)}.conf" aria-label="Download .conf" download>${icon('download')}</a>`
  return modal(title, `<div class="config">
<p class="hint">Scan the code in the WireGuard app, or copy the config into it.</p>
<div class="qr">${svg}</div>
${code(conf, download)}
</div>`, 'widest')
}

export function portModal(node: Node, devices: Device[] | null, message = '', port: number | string = node.port) {
  const title = `${escapeHtml(node.name)}'s port`
  if (!devices) {
    return modal(title, `<div class="modal-body"><div class="note">${escapeHtml(node.name)} is offline. Its port can change once it is back.</div></div>`)
  }
  return modal(title, `<form class="form" method="post" action="/nodes/${node.n}/port">
${message && `<div class="note">${message}</div>`}
<label>Port<span class="field"><input name="port" value="${escapeHtml(String(port))}" inputmode="numeric" autocomplete="off" autofocus required></span><small>The UDP port on the hub that ${escapeHtml(node.name)}'s devices dial.</small></label>
${devices.length ? `<div class="warn">Don't forget to update the config on ${escapeHtml(node.name)}'s devices.</div>` : ''}
${buttons('Save port')}
</form>`)
}

function names(nodes: Node[]) {
  const all = nodes.map((node) => escapeHtml(node.name))
  return all.length === 1 ? all[0] : `${all.slice(0, -1).join(', ')} and ${all.at(-1)}`
}

export function hubPortModal(port: number | string, offline: Node[], message = '') {
  if (offline.length) {
    return modal('Hub\'s port', `<div class="modal-body"><div class="note">${names(offline)} ${offline.length === 1 ? 'is offline. Wait until it is back to change the hub\'s port, or remove it if it is gone for good.' : 'are offline. Wait until they are back to change the hub\'s port, or remove them if they are gone for good.'}</div></div>`)
  }
  return modal('Hub\'s port', `<form class="form" method="post" action="/port">
${message && `<div class="note">${message}</div>`}
<label>Port<span class="field"><input name="port" value="${escapeHtml(String(port))}" inputmode="numeric" autocomplete="off" autofocus required></span><small>The UDP port on the hub that every node dials.</small></label>
<div class="warn">Each node drops for a few seconds while it moves to the new port.</div>
${buttons('Save port')}
</form>`)
}

export function notFoundPage() {
  return layout('Not found', `<section class="card"><div class="empty"><h3>Not found</h3></div></section>`)
}
