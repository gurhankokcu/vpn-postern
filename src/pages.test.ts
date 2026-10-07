import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { TreeView } from './pages.ts'

process.env.POSTERN_DIR = mkdtempSync(join(tmpdir(), 'postern-'))
const { addDeviceModal, addNodeModal, deviceModal, hubPortModal, joinModal, loginPage, notFoundPage, portModal, treePage } = await import('./pages.ts')

const home = { name: 'home', n: 2, port: 51822, publicKey: 'home' }
const work = { name: 'work', n: 3, port: 443, publicKey: 'work' }
const empty: TreeView = { hubPort: 51820, nodes: [], joins: [], devices: new Map() }
const both: TreeView = {
  ...empty,
  nodes: [home, work],
  devices: new Map([[2, [{ name: 'laptop', x: 2 }, { name: 'tablet', x: 3 }]], [3, null]]),
}

function rowOf(html: string, name: string) {
  return html.match(new RegExp(`<tr[^>]*>\\n<td class="name"><div class="cell">(?:(?!</tr>)[\\s\\S])*<b>${name}</b>(?:(?!</tr>)[\\s\\S])*</tr>`))?.[0] ?? ''
}

test('login page is a password form posting to /login', () => {
  const html = loginPage()
  assert.match(html, /^<!doctype html>/)
  assert.match(html, /<title>Log in · VPN Postern<\/title>/)
  assert.match(html, /<body class="login">/)
  assert.match(html, /<form class="card" method="post" action="\/login">/)
  assert.match(html, /<input name="password" type="password"/)
})

test('login page shows a message only when given one', () => {
  assert.doesNotMatch(loginPage(), /class="note"/)
  assert.match(loginPage('Wrong password.'), /<div class="note">Wrong password\.<\/div>/)
})

test('login page has no log out button', () => {
  assert.doesNotMatch(loginPage(), /\/logout/)
})

test('every page loads the stylesheet and the script', () => {
  for (const html of [loginPage(), treePage(empty), notFoundPage()]) {
    assert.match(html, /<link rel="stylesheet" href="\/style\.css">\n<script src="\/script\.js" defer><\/script>/)
  }
})

test('the tree starts at the hub, with its address, its port and Add node', () => {
  const html = treePage({ ...empty, hubPort: 443 })
  assert.match(html, /<title>Nodes · VPN Postern<\/title>/)
  assert.match(html, /<thead><tr><th>Name<\/th><th class="address">Address<\/th><th class="port">Port<\/th><th><\/th><\/tr><\/thead>/)
  assert.match(html, /<tr class="hub">\n<td class="name"><div class="cell"><span class="label"><i class="dot online" role="img" aria-label="online"><\/i><b>Hub<\/b><\/span><\/div><\/td>\n<td class="mono address">10\.99\.0\.1<\/td>\n<td class="mono port"><span class="value">443<a class="btn ghost act" href="\/port" aria-label="Change port"><svg [\s\S]*?<\/svg><\/a><\/span><\/td>\n<td class="acts"><a class="btn ghost act" href="\/new-node" aria-label="Add node"><svg /)
})

test('with no nodes, the tree offers the first one', () => {
  const html = treePage(empty)
  assert.match(html, /<span class="label">No nodes yet\. Add one for each home network to reach\.<\/span><a class="btn primary first" href="\/new-node">Add your first node<\/a>/)
  assert.doesNotMatch(treePage(both), /No nodes yet/)
})

test('a node shows its status, address and port; an online one, its devices and Add device', () => {
  const html = treePage(both)
  const row = rowOf(html, 'home')
  assert.match(row, /<i class="guide tee"><\/i><span class="label"><i class="dot online" role="img" aria-label="online"><\/i><b>home<\/b>/)
  assert.match(row, /<td class="mono address">10\.99\.0\.2<\/td>\n<td class="mono port"><span class="value">51822<a class="btn ghost act" href="\/nodes\/2\/port" aria-label="Change port">/)
  assert.match(row, /<a class="btn ghost act" href="\/nodes\/2\/new-device" aria-label="Add device">/)
  assert.match(rowOf(html, 'laptop'), /<i class="guide pass"><\/i><i class="guide tee"><\/i><span class="label"><b>laptop<\/b><\/span><\/div><\/td>\n<td class="mono address">10\.66\.66\.2<\/td>/)
  assert.match(rowOf(html, 'tablet'), /<i class="guide pass"><\/i><i class="guide elbow"><\/i>/)
})

test('a device can be shown and removed, asking first', () => {
  const row = rowOf(treePage(both), 'tablet')
  assert.match(row, /<a class="btn ghost act" href="\/nodes\/2\/devices\/tablet" aria-label="Show">/)
  assert.match(row, /<form method="post" action="\/nodes\/2\/devices\/tablet\/remove" data-confirm="Remove tablet\? It stops connecting until you add it again and scan its new QR code\." onsubmit="return confirm\(this\.dataset\.confirm\)"><button class="btn ghost act danger" aria-label="Remove">/)
})

test('an offline node is faint, says so, and offers no Add device', () => {
  const html = treePage(both)
  const row = rowOf(html, 'work')
  assert.match(row, /^<tr class="faint">\n<td class="name"><div class="cell"><i class="guide elbow"><\/i><span class="label"><i class="dot offline" role="img" aria-label="offline"><\/i>/)
  assert.doesNotMatch(row, /Add device/)
  assert.match(html, /<i class="guide blank"><\/i><i class="guide elbow"><\/i><span class="label">Offline\. Its devices show here once it is back\.<\/span>/)
})

test('a node waiting to join offers its join command and says it is waiting', () => {
  const html = treePage({ ...both, joins: [{ token: 'abc', n: 3, privateKey: 'key', expires: Date.now() + 60_000 }] })
  assert.match(rowOf(html, 'work'), /<a class="btn ghost act" href="\/nodes\/3\/join" aria-label="Join command">/)
  assert.doesNotMatch(rowOf(html, 'home'), /Join command/)
  assert.match(html, /Waiting to join\. Its devices show here once it does\./)
})

test('an online node without devices says so', () => {
  assert.match(treePage({ ...both, devices: new Map([[2, []], [3, null]]) }), /<span class="label">No devices yet\.<\/span>/)
})

test('removing a node asks first, naming how many devices lose their connection', () => {
  const ask = (devices: TreeView['devices']) => rowOf(treePage({ ...both, devices }), 'home').match(/data-confirm="([^"]*)"/)?.[1]
  assert.equal(ask(new Map([[2, [{ name: 'a', x: 2 }, { name: 'b', x: 3 }]]])), 'Remove home? It and its 2 devices lose their connection.')
  assert.equal(ask(new Map([[2, [{ name: 'a', x: 2 }]]])), 'Remove home? It and its 1 device lose their connection.')
  assert.equal(ask(new Map([[2, []]])), 'Remove home? It loses its connection.')
  assert.equal(ask(new Map([[2, null]])), 'Remove home? It and its devices lose their connection.')
  assert.match(rowOf(treePage(both), 'home'), /<form method="post" action="\/nodes\/2\/remove" data-confirm=/)
})

test('the tree escapes node and device names', () => {
  const evil = `<i>"&'`
  const html = treePage({ ...both, nodes: [{ ...home, name: evil }], devices: new Map([[2, [{ name: evil, x: 2 }]]]) })
  assert.match(html, /<b>&#60;i&#62;&#34;&#38;&#39;<\/b>/)
  assert.match(html, /data-confirm="Remove &#60;i&#62;&#34;&#38;&#39;\? It and its 1 device/)
  assert.doesNotMatch(html, /<i>"/)
})

test('the tree shows a message only when given one, and the modal after the tree', () => {
  assert.doesNotMatch(treePage(both), /class="note"/)
  assert.match(treePage({ ...both, message: 'home is offline.' }), /<main><div class="note">home is offline\.<\/div>\n<section class="card">/)
  assert.match(treePage({ ...both, modal: '<dialog>m</dialog>' }), /<\/table><\/section><dialog>m<\/dialog><\/main>/)
})

test('a modal opens over the page, named by its heading, closing back to the tree', () => {
  const html = addDeviceModal(home)
  assert.match(html, /^\n<dialog open aria-labelledby="modal-title">\n<div class="card-head"><h2 id="modal-title">Add a device to home<\/h2><a class="btn ghost act" href="\/" aria-label="Close">/)
})

test('add node asks for a name and a port, prefilled, posting to /nodes', () => {
  const html = addNodeModal(51824)
  assert.match(html, /<form class="form" method="post" action="\/nodes">/)
  assert.match(html, /<input name="nodeName" value="" autocomplete="off" autofocus required>/)
  assert.match(html, /<input name="port" value="51824" inputmode="numeric" autocomplete="off" required><\/span><small>The UDP port on the hub that this node's devices dial\.<\/small>/)
  assert.match(html, /<a class="btn ghost" href="\/">Cancel<\/a><button class="btn primary">Add node<\/button>/)
  assert.doesNotMatch(html, /class="note"/)
})

test('add node shows its message and what was typed, escaped', () => {
  const html = addNodeModal('4"3', 'Bad name.', `"><b>`)
  assert.match(html, /<div class="note">Bad name\.<\/div>/)
  assert.match(html, /name="nodeName" value="&#34;&#62;&#60;b&#62;"/)
  assert.match(html, /name="port" value="4&#34;3"/)
})

test('the join command sits in a code box, with the minutes left', () => {
  const html = joinModal(work, 'curl https://hub/join/abc | sudo sh', Date.now() + 58 * 60_000)
  assert.match(html, /<dialog open class="wide"/)
  assert.match(html, /<h2 id="modal-title">Join work<\/h2>/)
  assert.match(html, /<p>Run this on work as root\. It works once, within the hour\.<\/p>/)
  assert.match(html, /<div class="code"><pre tabindex="0">curl https:\/\/hub\/join\/abc \| sudo sh<\/pre><div class="tools"><button type="button" class="btn ghost act" aria-label="Copy" data-copy>/)
  assert.match(html, /<small>Expires in 58 minutes\.<\/small>/)
  assert.match(joinModal(work, 'x', Date.now() + 20_000), /Expires in 1 minute\./)
})

test('add device asks only for a name, posting to its node', () => {
  const html = addDeviceModal(home, 'Taken.', 'mum')
  assert.match(html, /<form class="form" method="post" action="\/nodes\/2\/devices">\n<div class="note">Taken\.<\/div>/)
  assert.match(html, /<input name="deviceName" value="mum" autocomplete="off" autofocus required>/)
  assert.doesNotMatch(html, /name="port"/)
})

test('a node\'s port can be changed, online or not', () => {
  const html = treePage(both)
  assert.match(rowOf(html, 'work'), /<a class="btn ghost act" href="\/nodes\/3\/port" aria-label="Change port">/)
  assert.doesNotMatch(rowOf(html, 'laptop'), /Change port/)
})

test('changing a port asks for it, prefilled, posting to its node', () => {
  const html = portModal(home, [])
  assert.match(html, /<h2 id="modal-title">home's port<\/h2>/)
  assert.match(html, /<form class="form" method="post" action="\/nodes\/2\/port">/)
  assert.match(html, /<input name="port" value="51822" inputmode="numeric" autocomplete="off" autofocus required><\/span><small>The UDP port on the hub that home's devices dial\.<\/small>/)
  assert.match(html, /<a class="btn ghost" href="\/">Cancel<\/a><button class="btn primary">Save port<\/button>/)
  assert.doesNotMatch(html, /class="note"|class="warn"/)
})

test('changing the port of a node with devices reminds to update their configs', () => {
  assert.match(portModal(home, [{ name: 'laptop', x: 2 }]), /<div class="warn">Don't forget to update the config on home's devices\.<\/div>/)
})

test('changing a port shows its message and what was typed, escaped', () => {
  const html = portModal({ ...home, name: '<b>' }, [], 'Taken.', '4"3')
  assert.match(html, /<div class="note">Taken\.<\/div>/)
  assert.match(html, /name="port" value="4&#34;3"/)
  assert.match(html, /<h2 id="modal-title">&#60;b&#62;'s port<\/h2>/)
})

test('an offline node\'s port says it can change once it is back, with no form', () => {
  const html = portModal(home, null)
  assert.match(html, /<div class="note">home is offline\. Its port can change once it is back\.<\/div>/)
  assert.doesNotMatch(html, /<form/)
})

test('changing the hub\'s port asks for it, prefilled, warning that each node drops for a moment', () => {
  const html = hubPortModal(51820, [])
  assert.match(html, /<h2 id="modal-title">Hub's port<\/h2>/)
  assert.match(html, /<form class="form" method="post" action="\/port">/)
  assert.match(html, /<input name="port" value="51820" inputmode="numeric" autocomplete="off" autofocus required><\/span><small>The UDP port on the hub that every node dials\.<\/small>/)
  assert.match(html, /<div class="warn">Each node drops for a few seconds while it moves to the new port\.<\/div>/)
  assert.match(html, /<button class="btn primary">Save port<\/button>/)
  assert.doesNotMatch(html, /class="note"/)
})

test('changing the hub\'s port shows its message and what was typed, escaped', () => {
  const html = hubPortModal('4"3', [], 'Taken.')
  assert.match(html, /<div class="note">Taken\.<\/div>/)
  assert.match(html, /name="port" value="4&#34;3"/)
})

test('the hub\'s port names the offline nodes it waits for, with no form', () => {
  const evil = { ...work, name: '<b>' }
  assert.match(hubPortModal(51820, [work]), /<div class="note">work is offline\. Wait until it is back to change the hub's port, or remove it if it is gone for good\.<\/div>/)
  assert.match(hubPortModal(51820, [home, work]), /home and work are offline\. Wait until they are back to change the hub's port, or remove them if they are gone for good\./)
  assert.match(hubPortModal(51820, [home, work, evil]), /home, work and &#60;b&#62; are offline\./)
  assert.doesNotMatch(hubPortModal(51820, [work]), /<form/)
})

test('a device shows its QR code beside its config, to copy or download', () => {
  const html = deviceModal(home, 'tablet', 'Endpoint = <hub>:51822\n', '<svg>qr</svg>')
  assert.match(html, /<dialog open class="widest"/)
  assert.match(html, /<h2 id="modal-title">tablet <span class="pill">home<\/span><\/h2>/)
  assert.match(html, /<p class="hint">Scan the code in the WireGuard app, or copy the config into it\.<\/p>\n<div class="qr"><svg>qr<\/svg><\/div>/)
  assert.match(html, /<pre tabindex="0">Endpoint = &#60;hub&#62;:51822\n<\/pre>/)
  assert.match(html, /<a class="btn ghost act" href="\/nodes\/2\/devices\/tablet\.conf" aria-label="Download \.conf" download>/)
})

test('a device on an offline node says so, with nothing to copy', () => {
  const html = deviceModal(home, 'tablet', null)
  assert.match(html, /<div class="note">home is offline\. Its QR code shows here once it is back\.<\/div>/)
  assert.doesNotMatch(html, /class="code"|class="qr"/)
})

test('logged-in pages have a log out button', () => {
  for (const html of [treePage(empty), notFoundPage()]) {
    assert.match(html, /<form method="post" action="\/logout"><button class="btn ghost">Log out<\/button><\/form>/)
  }
})

test('not found page says so', () => {
  const html = notFoundPage()
  assert.match(html, /<title>Not found · VPN Postern<\/title>/)
  assert.match(html, /<h3>Not found<\/h3>/)
})
