import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.POSTERN_DIR = mkdtempSync(join(tmpdir(), 'postern-'))
const { loginPage, nodesPage, notFoundPage } = await import('./pages.ts')

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
  const html = nodesPage([])
  assert.match(html, /<title>Nodes · VPN Postern<\/title>/)
  assert.match(html, /<body>/)
  assert.match(html, /0 total/)
  assert.match(html, /No nodes yet/)
  assert.doesNotMatch(html, /<table>/)
})

test('nodes page lists each node with its address and port', () => {
  const html = nodesPage([{ name: 'home', n: 1, publicKey: 'key' }, { name: 'work', n: 2, publicKey: 'key' }])
  assert.match(html, /2 total/)
  assert.doesNotMatch(html, /No nodes yet/)
  assert.match(html, /<td><b>home<\/b><\/td>\n<td class="mono">10\.99\.0\.1<\/td>\n<td class="mono">51821<\/td>/)
  assert.match(html, /<td><b>work<\/b><\/td>\n<td class="mono">10\.99\.0\.2<\/td>\n<td class="mono">51822<\/td>/)
})

test('nodes page escapes node names', () => {
  const html = nodesPage([{ name: `<script>"&'</script>`, n: 1, publicKey: 'key' }])
  assert.match(html, /<b>&#60;script&#62;&#34;&#38;&#39;&#60;\/script&#62;<\/b>/)
  assert.doesNotMatch(html, /<script>/)
})

test('nodes page has a form to add a node by name', () => {
  assert.match(nodesPage([]), /<form class="add" method="post" action="\/nodes">\n<span class="field"><input name="nodeName" [^>]*required><\/span>\n<button class="btn primary">Add node<\/button>/)
})

test('nodes page shows a message only when given one', () => {
  assert.doesNotMatch(nodesPage([]), /class="note"/)
  assert.match(nodesPage([], 'Bad name.'), /<main><div class="note">Bad name\.<\/div>\n<section class="card">/)
})

test('nodes page fills the form with the name given, escaped', () => {
  assert.doesNotMatch(nodesPage([]), /value=/)
  assert.match(nodesPage([], 'Bad name.', `"><b>&'`), /<input name="nodeName" value="&#34;&#62;&#60;b&#62;&#38;&#39;" placeholder/)
})

test('signed-in pages have a log out button', () => {
  for (const html of [nodesPage([]), notFoundPage()]) {
    assert.match(html, /<form method="post" action="\/logout"><button class="btn ghost">Log out<\/button><\/form>/)
  }
})

test('not found page says so', () => {
  const html = notFoundPage()
  assert.match(html, /<title>Not found · VPN Postern<\/title>/)
  assert.match(html, /<h3>Not found<\/h3>/)
})
