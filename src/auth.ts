import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const secret = randomBytes(32)
const sessionMs = 12 * 60 * 60 * 1000
const lockoutMs = 15 * 60 * 1000
const maxFails = 5
const fails = new Map<string, { count: number; until: number }>()

function same(a: Buffer, b: Buffer) {
  return a.length === b.length && timingSafeEqual(a, b)
}

function sign(value: string) {
  return createHmac('sha256', secret).update(value).digest('hex')
}

export function hash(password: string) {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`
}

export function verify(password: string, stored: string) {
  const [salt = '', key = ''] = stored.split(':')
  return same(scryptSync(password, Buffer.from(salt, 'hex'), 64), Buffer.from(key, 'hex'))
}

function cookie(value: string, extra = '') {
  return `session=${value}${extra}; HttpOnly; Secure; SameSite=Strict; Path=/`
}

export function sessionCookie() {
  const expiry = String(Date.now() + sessionMs)
  return cookie(`${expiry}.${sign(expiry)}`)
}

export function expiredCookie() {
  return cookie('', '; Max-Age=0')
}

export function valid(header = '') {
  const [expiry = '', mac = ''] = (header.match(/(?:^|;\s*)session=([^;]*)/)?.[1] ?? '').split('.')
  return Number(expiry) > Date.now() && same(Buffer.from(mac), Buffer.from(sign(expiry)))
}

export function locked(ip: string) {
  const entry = fails.get(ip)
  return entry !== undefined && entry.count >= maxFails && entry.until > Date.now()
}

export function fail(ip: string) {
  const now = Date.now()
  const entry = fails.get(ip)
  if (!entry || entry.until <= now) {
    fails.set(ip, { count: 1, until: now + lockoutMs })
    return
  }
  entry.count += 1
  if (entry.count === maxFails) {
    entry.until = now + lockoutMs
  }
}

export function clear(ip: string) {
  fails.delete(ip)
}
