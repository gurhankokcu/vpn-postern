import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { type Browser, chromium, type Page } from 'playwright-core'
import { node, setPasswordAndLogin } from './sim.ts'

// The sim publishes the hub's 8443 on this machine, where the installed Chrome runs headless.
const hub = 'https://localhost:8443'
const password = 'use browser e2e'
let browser: Browser
let page: Page
let n = 0

before(async () => {
  await setPasswordAndLogin(password)
  n = (await node('home-pi')).n
  browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: hub })
  page = await context.newPage()
})

after(() => browser?.close())

function path() {
  return new URL(page.url()).pathname
}

// The range's own text, as Selection's drops a pre's trailing newline.
function selected() {
  return page.evaluate('getSelection().getRangeAt(0).toString()')
}

function row(name: string) {
  return page.locator(`tr:has(b:text-is("${name}"))`)
}

async function centre(selector: string) {
  const box = (await page.locator(selector).boundingBox())!
  return box.x + box.width / 2
}

function fontSize(target: Page, selector: string) {
  return target.evaluate<string>(`getComputedStyle(document.querySelector('${selector}')).fontSize`)
}

// Clicks a row's Remove and answers the browser's question, which it returns.
async function remove(name: string, yes: boolean) {
  const question = new Promise<string>((resolve) => {
    page.once('dialog', (dialog) => {
      resolve(dialog.message())
      void (yes ? dialog.accept() : dialog.dismiss())
    })
  })
  await row(name).locator('button[aria-label="Remove"]').click()
  return question
}

test('a wrong password is refused, and the right one opens the tree', async () => {
  await page.goto(`${hub}/login`)
  await page.fill('input[name="password"]', 'not the password')
  await page.click('button:text-is("Log in")')
  await page.waitForSelector('.note:text-is("Wrong password.")')
  await page.fill('input[name="password"]', password)
  await page.click('button:text-is("Log in")')
  await page.waitForURL(`${hub}/`)
  assert.equal(await row('home-pi').count(), 1)
})

test('a modal opened from the tree is modal, keeps its address and focuses its Name', async () => {
  await page.click('a[aria-label="Add node"]')
  await page.waitForURL(`${hub}/new-node`)
  // The close event from the script's close() arrives after the page has loaded.
  await page.waitForTimeout(200)
  assert.equal(path(), '/new-node')
  assert.equal(await page.evaluate('document.querySelector("dialog").matches(":modal")'), true)
  assert.equal(await page.evaluate('document.activeElement.name'), 'name')
})

test('closing a modal puts the address back to the tree', async () => {
  await page.keyboard.press('Escape')
  await page.waitForFunction('location.pathname === "/"')
  assert.equal(await page.evaluate('document.querySelector("dialog").open'), false)
})

test('add device focuses its Name', async () => {
  await page.goto(`${hub}/nodes/${n}/new-device`)
  assert.equal(await page.evaluate('document.activeElement.name'), 'name')
})

test('a hover label sits above its button, inside the window', async () => {
  await page.goto(`${hub}/`)
  const button = page.locator('tr:has(b:text-is("home-pi")) button[aria-label="Remove"]')
  await button.hover()
  const tip = page.locator('.tip')
  assert.equal(await tip.textContent(), 'Remove')
  const b = (await button.boundingBox())!
  const t = (await tip.boundingBox())!
  assert.ok(t.y + t.height <= b.y)
  assert.ok(t.x >= 8 && t.x + t.width <= page.viewportSize()!.width - 8)
})

test('a node\'s pencil opens its port modal, focused on Port, and a taken port comes back in it', async () => {
  await page.goto(`${hub}/`)
  await row('home-pi').locator('a[aria-label="Change port"]').click()
  await page.waitForURL(`${hub}/nodes/${n}/port`)
  assert.equal(await page.evaluate('document.activeElement.name'), 'port')
  const hubPort = await page.textContent('tr.hub td.port')
  await page.fill('input[name="port"]', hubPort ?? '')
  await page.click('dialog button:text-is("Save port")')
  await page.waitForSelector('dialog .note:text-is("The hub or another node already uses that port.")')
  assert.equal(await page.inputValue('input[name="port"]'), hubPort)
})

test('the hub\'s pencil opens its port modal, focused on Port, and a node\'s port comes back in it', async () => {
  await page.goto(`${hub}/`)
  await page.click('tr.hub a[aria-label="Change port"]')
  await page.waitForURL(`${hub}/port`)
  assert.equal(await page.evaluate('document.activeElement.name'), 'port')
  const port = String((await node('home-pi')).port)
  await page.fill('input[name="port"]', port)
  await page.click('dialog button:text-is("Save port")')
  await page.waitForSelector('dialog .note:text-is("A node already uses that port.")')
  assert.equal(await page.inputValue('input[name="port"]'), port)
})

test('a pencil\'s hover label sits above it, inside the window', async () => {
  await page.goto(`${hub}/`)
  for (const button of [page.locator('tr.hub a[aria-label="Change port"]'), row('home-pi').locator('a[aria-label="Change port"]')]) {
    await button.hover()
    const tip = page.locator('.tip')
    assert.equal(await tip.textContent(), 'Change port')
    const b = (await button.boundingBox())!
    const t = (await tip.boundingBox())!
    assert.ok(t.y + t.height <= b.y)
    assert.ok(t.x >= 8 && t.x + t.width <= page.viewportSize()!.width - 8)
  }
})

test('copy puts the config on the clipboard and says so', async () => {
  await page.goto(`${hub}/nodes/${n}/devices/laptop`)
  await page.click('[data-copy]')
  await page.waitForSelector('[data-copy][aria-label="Copied"]')
  assert.equal(await page.evaluate('navigator.clipboard.readText()'), await page.textContent('.code pre'))
})

test('a second click while copy says Copied still brings back its own icon', async () => {
  await page.waitForSelector('[data-copy][aria-label="Copy"]')
  const icon = await page.innerHTML('[data-copy]')
  await page.click('[data-copy]')
  await page.waitForSelector('[data-copy][aria-label="Copied"]')
  await page.click('[data-copy]')
  await page.waitForTimeout(2000)
  assert.equal(await page.getAttribute('[data-copy]', 'aria-label'), 'Copy')
  assert.equal(await page.innerHTML('[data-copy]'), icon)
})

test('a label moved on from Copy stays where the pointer is', async () => {
  await page.click('[data-copy]')
  await page.waitForSelector('[data-copy][aria-label="Copied"]')
  const download = page.locator('a[aria-label="Download .conf"]')
  await download.hover()
  await page.waitForTimeout(2000)
  assert.equal(await page.textContent('.tip'), 'Download .conf')
  const tip = await centre('.tip')
  assert.ok(Math.abs(tip - await centre('a[aria-label="Download .conf"]')) < Math.abs(tip - await centre('[data-copy]')))
})

test('Cmd+A in a code box selects the whole box', async () => {
  await page.focus('.code pre')
  await page.keyboard.press('ControlOrMeta+a')
  assert.equal(await selected(), await page.textContent('.code pre'))
})

test('a fourth click in a code box selects the whole box', async () => {
  await page.evaluate('getSelection().removeAllRanges()')
  await page.click('.code pre', { clickCount: 4 })
  assert.equal(await selected(), await page.textContent('.code pre'))
})

test('a taken name comes back in the add node modal, and a new one opens its join command', async () => {
  await page.goto(`${hub}/`)
  await page.click('a[aria-label="Add node"]')
  await page.fill('input[name="name"]', 'HOME-PI')
  await page.click('dialog button:text-is("Add node")')
  await page.waitForSelector('dialog .note:text-is("Another node already has that name.")')
  assert.equal(await page.inputValue('input[name="name"]'), 'HOME-PI')
  await page.fill('input[name="name"]', 'Garden-Pi')
  await page.click('dialog button:text-is("Add node")')
  await page.waitForSelector('dialog h2:text-is("Join Garden-Pi")')
  assert.match(path(), /^\/nodes\/\d+\/join$/)
  assert.match(await page.textContent('dialog pre') ?? '', /^curl -fsSk --pinnedpubkey sha256\/\/\S+ https:\/\/localhost:8443\/join\/\S+ \| sudo sh$/)
})

test('a device added from the tree shows its QR code, and closing it goes back to the tree', async () => {
  await page.goto(`${hub}/`)
  await row('home-pi').locator('a[aria-label="Add device"]').click()
  await page.fill('input[name="name"]', 'watch')
  await page.click('dialog button:text-is("Add device")')
  await page.waitForURL(`${hub}/nodes/${n}/devices/watch`)
  assert.equal(await page.locator('dialog .qr svg').count(), 1)
  await page.click('dialog a[aria-label="Close"]')
  await page.waitForURL(`${hub}/`)
  assert.equal(await row('watch').count(), 1)
})

test('removing a device asks first, and goes only once the answer is yes', async () => {
  assert.equal(await remove('watch', false), 'Remove watch? It stops connecting until you add it again and scan its new QR code.')
  assert.equal(await row('watch').count(), 1)
  await remove('watch', true)
  await row('watch').waitFor({ state: 'detached' })
})

test('removing a node asks first, and goes only once the answer is yes', async () => {
  assert.equal(await remove('Garden-Pi', false), 'Remove Garden-Pi? It and its devices lose their connection.')
  assert.equal(await row('Garden-Pi').count(), 1)
  await remove('Garden-Pi', true)
  await row('Garden-Pi').waitFor({ state: 'detached' })
})

test('on a phone, a node with the longest name keeps its buttons inside the window', async () => {
  const name = 'The-Pi-in-the-shed-at-the-bottom'
  await page.goto(`${hub}/new-node`)
  await page.fill('input[name="name"]', name)
  await page.click('dialog button:text-is("Add node")')
  await page.waitForSelector(`dialog h2:text-is("Join ${name}")`)
  await page.setViewportSize({ width: 375, height: 740 })
  await page.goto(`${hub}/`)
  const button = (await row(name).locator('button[aria-label="Remove"]').boundingBox())!
  assert.ok(button.x + button.width <= 375)
  assert.ok(await page.evaluate<number>('document.documentElement.scrollWidth') <= 375)
  await remove(name, true)
  await row(name).waitFor({ state: 'detached' })
  await page.setViewportSize({ width: 1280, height: 720 })
})

test('on a touch screen every field is 16px, so tapping one does not zoom the page', async () => {
  const phone = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await phone.goto(`${hub}/login`)
  assert.equal(await fontSize(phone, 'input[name="password"]'), '16px')
  await phone.fill('input[name="password"]', password)
  await phone.click('button:text-is("Log in")')
  await phone.waitForURL(`${hub}/`)
  await phone.goto(`${hub}/new-node`)
  assert.equal(await fontSize(phone, 'input[name="name"]'), '16px')
  await phone.close()
  await page.goto(`${hub}/new-node`)
  assert.equal(await fontSize(page, 'input[name="name"]'), '13.5px')
  await page.goto(`${hub}/`)
})

test('logging out goes to the login page, and the tree is closed until logging in again', async () => {
  await page.click('button:text-is("Log out")')
  await page.waitForURL(`${hub}/login`)
  await page.goto(`${hub}/`)
  assert.equal(path(), '/login')
})
