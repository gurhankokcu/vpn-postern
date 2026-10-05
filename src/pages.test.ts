import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { NodesView } from './pages.ts'

process.env.POSTERN_DIR = mkdtempSync(join(tmpdir(), 'postern-'))
const { loginPage, nodesPage, notFoundPage } = await import('./pages.ts')

const view: NodesView = { nodes: [], joins: [], handshakes: new Map(), host: 'hub:8443', pin: 'pin' }

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

test('nodes page with no nodes says so', () => {
  const html = nodesPage(view)
  assert.match(html, /<title>Nodes · VPN Postern<\/title>/)
  assert.match(html, /<body>/)
  assert.match(html, /0 total/)
  assert.match(html, /No nodes yet/)
  assert.doesNotMatch(html, /<table>/)
})

test('nodes page lists each node with its status, address and port', () => {
  const html = nodesPage({ ...view, nodes: [{ name: 'home', n: 1, publicKey: 'key' }, { name: 'work', n: 2, publicKey: 'key' }] })
  assert.match(html, /2 total/)
  assert.doesNotMatch(html, /No nodes yet/)
  assert.match(html, /<th>Name<\/th><th>Status<\/th><th>Address<\/th><th>Port<\/th><th><\/th><\/tr>/)
  assert.match(html, /<td><b>home<\/b><\/td>\n<td><span class="pill offline">offline<\/span><\/td>\n<td class="mono">10\.99\.0\.1<\/td>\n<td class="mono">51821<\/td>/)
  assert.match(html, /<td><b>work<\/b><\/td>\n<td><span class="pill offline">offline<\/span><\/td>\n<td class="mono">10\.99\.0\.2<\/td>\n<td class="mono">51822<\/td>/)
})

test('nodes page shows a node online only after a handshake under 3 minutes ago', () => {
  const nodes = [{ name: 'fresh', n: 2, publicKey: 'fresh' }, { name: 'stale', n: 3, publicKey: 'stale' }, { name: 'never', n: 4, publicKey: 'never' }]
  const handshakes = new Map([['fresh', Date.now() - 179_000], ['stale', Date.now() - 181_000], ['never', 0]])
  const html = nodesPage({ ...view, nodes, handshakes })
  assert.match(html, /<b>fresh<\/b><\/td>\n<td><span class="pill online">online<\/span>/)
  assert.match(html, /<b>stale<\/b><\/td>\n<td><span class="pill offline">offline<\/span>/)
  assert.match(html, /<b>never<\/b><\/td>\n<td><span class="pill offline">offline<\/span>/)
})

test('nodes page shows a node missing from the handshakes offline', () => {
  assert.match(nodesPage({ ...view, nodes: [{ name: 'home', n: 2, publicKey: 'key' }] }), /<span class="pill offline">offline<\/span>/)
})

test('nodes page has a remove button on every node, asking first', () => {
  const html = nodesPage({ ...view, nodes: [{ name: 'home', n: 2, publicKey: 'key' }, { name: 'work', n: 3, publicKey: 'key' }] })
  assert.match(html, /<td class="mono">51822<\/td>\n<td class="action"><form method="post" action="\/nodes\/2\/remove" data-confirm="Remove home\? It stops working until you add it and run its new join command\." onsubmit="return confirm\(this\.dataset\.confirm\)"><button class="btn ghost">Remove<\/button><\/form><\/td>\n<\/tr>/)
  assert.match(html, /action="\/nodes\/3\/remove" data-confirm="Remove work\?/)
})

test('nodes page escapes the node name in the remove question', () => {
  assert.match(nodesPage({ ...view, nodes: [{ name: `"><b>&'`, n: 2, publicKey: 'key' }] }), /data-confirm="Remove &#34;&#62;&#60;b&#62;&#38;&#39;\? /)
})

test('nodes page escapes node names', () => {
  const html = nodesPage({ ...view, nodes: [{ name: `<script>"&'</script>`, n: 1, publicKey: 'key' }] })
  assert.match(html, /<b>&#60;script&#62;&#34;&#38;&#39;&#60;\/script&#62;<\/b>/)
  assert.doesNotMatch(html, /<script>/)
})

test('nodes page has a form to add a node by name', () => {
  assert.match(nodesPage(view), /<form class="add" method="post" action="\/nodes">\n<span class="field"><input name="nodeName" [^>]*required><\/span>\n<button class="btn primary">Add node<\/button>/)
})

test('nodes page shows a message only when given one', () => {
  assert.doesNotMatch(nodesPage(view), /class="note"/)
  assert.match(nodesPage({ ...view, message: 'Bad name.' }), /<main><div class="note">Bad name\.<\/div>\n<section class="card">/)
})

test('nodes page fills the form with the name given, escaped', () => {
  assert.doesNotMatch(nodesPage(view), /value=/)
  assert.match(nodesPage({ ...view, message: 'Bad name.', nodeName: `"><b>&'` }), /<input name="nodeName" value="&#34;&#62;&#60;b&#62;&#38;&#39;" placeholder/)
})

test('nodes page shows the pinned join command under a node waiting to join', () => {
  const nodes = [{ name: 'home', n: 2, publicKey: 'key' }, { name: 'work', n: 3, publicKey: 'key' }]
  const joins = [{ token: 'abc', n: 2, privateKey: 'key', expires: Date.now() + 60_000 }]
  const html = nodesPage({ ...view, nodes, joins, pin: 'pin=' })
  assert.match(html, /<td class="mono">51822<\/td>\n<td class="action">.*<\/td>\n<\/tr>\n<tr class="join"><td colspan="5"><code class="mono">curl -fsSk --pinnedpubkey sha256\/\/pin= https:\/\/hub:8443\/join\/abc \| sudo sh<\/code><\/td><\/tr>/)
  assert.equal(html.match(/class="join"/g)?.length, 1)
})

test('nodes page hides an expired join', () => {
  const joins = [{ token: 'abc', n: 2, privateKey: 'key', expires: Date.now() - 1 }]
  assert.doesNotMatch(nodesPage({ ...view, nodes: [{ name: 'home', n: 2, publicKey: 'key' }], joins }), /class="join"/)
})

test('nodes page escapes the host in the join command', () => {
  const joins = [{ token: 'abc', n: 2, privateKey: 'key', expires: Date.now() + 60_000 }]
  const html = nodesPage({ ...view, nodes: [{ name: 'home', n: 2, publicKey: 'key' }], joins, host: '"><b>' })
  assert.match(html, /https:\/\/&#34;&#62;&#60;b&#62;\/join\/abc/)
})

test('signed-in pages have a log out button', () => {
  for (const html of [nodesPage(view), notFoundPage()]) {
    assert.match(html, /<form method="post" action="\/logout"><button class="btn ghost">Log out<\/button><\/form>/)
  }
})

test('not found page says so', () => {
  const html = notFoundPage()
  assert.match(html, /<title>Not found · VPN Postern<\/title>/)
  assert.match(html, /<h3>Not found<\/h3>/)
})
