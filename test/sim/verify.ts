#!/usr/bin/env node
import { execFile } from 'node:child_process'

type Result = { ok: boolean; out: string; err: string }
type Check = [name: string, got: string, want: string]
type Nat = [router: string, sender: string, ports: number]

const machines: Record<string, { at: string; lan?: string; wan?: string }> = {
  'hub':         { at: 'internet', wan: '172.30.0.10' },
  'home-router': { at: 'home',     lan: '192.168.1.1',  wan: '172.30.0.20' },
  'work-router': { at: 'work',     lan: '192.168.1.1',  wan: '172.30.0.30' },
  'carrier-gw':  { at: 'carrier',  lan: '100.64.0.1',   wan: '172.30.0.40' },
  'tablet':      { at: 'internet', wan: '172.30.0.50' },
  'example.com': { at: 'internet', wan: '172.30.0.60' },
  'home-pi':     { at: 'home',     lan: '192.168.1.10' },
  'laptop':      { at: 'home',     lan: '192.168.1.20' },
  'camera':      { at: 'home',     lan: '192.168.1.30' },
  'work-pi':     { at: 'work',     lan: '192.168.1.10' },
  'desktop':     { at: 'work',     lan: '192.168.1.20' },
  'printer':     { at: 'work',     lan: '192.168.1.30' },
  'phone':       { at: 'carrier',  lan: '100.64.0.20' },
}
const names = Object.keys(machines)
// The last two are the real internet and the Mac, as Docker Desktop reaches it.
const addresses = [
  '192.168.1.1', '192.168.1.10', '192.168.1.20', '192.168.1.30', '100.64.0.1', '100.64.0.20',
  '172.30.0.10', '172.30.0.20', '172.30.0.30', '172.30.0.40', '172.30.0.50', '172.30.0.60',
  '1.1.1.1', '192.168.65.254',
]
const webs = ['camera', 'printer', 'example.com']
const nats: Nat[] = [
  ['home-router', 'laptop', 1],
  ['work-router', 'desktop', 1],
  ['carrier-gw', 'phone', 2],
]
// Each fresh machine: a neighbour that finds its sshd, and what gets installed on it.
const fresh: Record<string, [neighbour: string, packages: string]> = {
  'hub':     ['tablet',      'wireguard-tools nftables qrencode'],
  'home-pi': ['home-router', 'wireguard-tools nftables'],
  'work-pi': ['work-router', 'wireguard-tools nftables'],
}

const sendTwice = `node -e '
  const socket = require("node:dgram").createSocket("udp4")
  socket.send("hello", 9999, "hub", () => socket.send("hello", 9999, "example.com", () => socket.close()))
'`

function run(command: string, ...args: string[]) {
  return new Promise<Result>((resolve) => {
    execFile(command, args, (error, out, err) => resolve({ ok: !error, out: out.trim(), err: err.trim() }))
  })
}

async function must(command: string, ...args: string[]) {
  const { ok, out, err } = await run(command, ...args)
  if (!ok) {
    throw new Error(`${[command, ...args].join(' ')}: ${err}`)
  }
  return out
}

function sh(machine: string, script: string) {
  return run('docker', 'exec', machine, 'sh', '-c', script)
}

let survey: Record<string, string> = {}

async function surveyEveryone() {
  survey = Object.fromEntries(await Promise.all(names.map(async (m) => [m, (await sh(m, 'ip -o addr; ip -o link')).out])))
}

function holds(m: string, address: string) {
  return survey[m].includes(`inet ${address}/`)
}

function owner(m: string, address: string) {
  return names.find((x) => machines[x].wan === address || (machines[x].lan === address && machines[x].at === machines[m].at)) ?? 'nothing'
}

function gateway(m: string) {
  return names.find((x) => machines[x].at === machines[m].at && machines[x].wan)!
}

function answerer(m: string, address: string, neighbour: string) {
  if (holds(m, address)) {
    return m
  }
  const mac = neighbour.match(/lladdr (\S+)/)?.[1]
  if (mac) {
    return names.find((x) => survey[x].includes(`link/ether ${mac} `)) ?? mac
  }
  return names.find((x) => holds(x, address)) ?? address
}

async function ping(m: string, address: string): Promise<Check> {
  const { ok, out } = await sh(m, `ping -c 1 -W 1 ${address} >/dev/null && ip neigh show ${address}`)
  return [`${m} pings ${address}`, ok ? answerer(m, address, out) : 'nothing', owner(m, address)]
}

async function curl(m: string, address: string): Promise<Check> {
  const { out } = await sh(m, `curl -s -m 2 http://${address}`)
  const web = webs.includes(owner(m, address)) ? owner(m, address) : 'nothing'
  return [`${m} curls ${address}`, out ? JSON.parse(out).server : 'nothing', web]
}

function everyAddress(m: string) {
  return addresses.flatMap((address) => [ping(m, address), curl(m, address)])
}

async function seenAs(m: string): Promise<Check> {
  const { out } = await sh(m, 'curl -s -m 2 http://example.com')
  const wan = machines[m].wan ?? machines[gateway(m)].wan!
  return [`example.com sees ${m} as`, out ? JSON.parse(out).client : 'nothing', wan]
}

async function privateAddresses(): Promise<Check> {
  const out = await must('docker', 'logs', 'example.com')
  const found = new Set(out.match(/(192\.168|100\.64)\.\d+\.\d+/g))
  return ["private addresses in example.com's log", [...found].join(', ') || 'none', 'none']
}

async function publicPorts([router, sender, ports]: Nat): Promise<Check> {
  await sh(router, 'conntrack -F')
  await sh(sender, sendTwice)
  const { out } = await sh(router, 'conntrack -L -p udp --dport 9999')
  const found = new Set([...out.matchAll(/dport=9999 .*dport=(\d+)/g)].map((match) => match[1]))
  return [`public ports for one socket behind ${router}`, `${found.size}`, `${ports}`]
}

async function through(router: string): Promise<Check[]> {
  const behind = names.filter((x) => machines[x].at === machines[router].at && x !== router).map((x) => machines[x].lan!)
  await must('docker', 'exec', 'tablet', 'ip', 'route', 'add', 'default', 'via', machines[router].wan!)
  const checks = await Promise.all(behind.flatMap((address) => [ping('tablet', address), curl('tablet', address)]))
  await must('docker', 'exec', 'tablet', 'ip', 'route', 'del', 'default')
  return checks.map(([name, got, want]) => [`${name} through ${router}`, got, want])
}

async function resolves(m: string, name: string, want: string): Promise<Check> {
  const { out } = await sh(m, `getent hosts ${name}`)
  return [`${m} resolves ${name}`, out.split(' ')[0] || 'nothing', want]
}

async function hostKey(m: string): Promise<Check> {
  const [neighbour] = fresh[m]
  const address = machines[m].wan ?? machines[m].lan!
  const { out } = await sh(neighbour, `ssh-keyscan -t ed25519 ${address}`)
  const key = out.split('\n').find((line) => !line.startsWith('#')) ?? ''
  return [`${neighbour} finds ${m}'s host key`, key.split(' ')[1] ?? 'nothing', 'ssh-ed25519']
}

async function installs(m: string): Promise<Check> {
  const [, packages] = fresh[m]
  const { ok } = await sh(m, `apt-get install -y --download-only --no-download ${packages}`)
  return [`${m} installs ${packages} from apt's cache`, ok ? 'yes' : 'no', 'yes']
}

let total = 0
const failures: string[] = []

function report(title: string, checks: Check[]) {
  console.log(`\n${title}`)
  for (const [name, got, want] of checks) {
    const line = got === want ? `✓ ${name}: ${got}` : `✗ ${name}: ${got}, expected ${want}`
    if (got !== want) {
      failures.push(`${title}: ${line}`)
    }
    console.log(`  ${line}`)
    total++
  }
}

process.chdir(import.meta.dirname)

const running = (await run('docker', 'ps', '--format', '{{.Names}}')).out.split('\n')
const stopped = names.filter((m) => !running.includes(m))
if (stopped.length) {
  console.log(`Not running: ${stopped.join(', ')}`)
  process.exit(1)
}

async function checkEverything(when: string) {
  await surveyEveryone()
  report(`From every machine, every address${when}`, await Promise.all(names.flatMap(everyAddress)))
  report(`The internet sees every machine as its public address${when}`, await Promise.all(names.map(seenAs)))
  report(`No private address ever reaches the internet${when}`, [await privateAddresses()])
  report(`Two kinds of NAT${when}`, await Promise.all(nats.map(publicPorts)))
  report(`A NAT lets nothing in${when}`, [
    ...(await through('home-router')),
    ...(await through('work-router')),
    ...(await through('carrier-gw')),
  ])
  report(`Names${when}`, await Promise.all(names.flatMap((m) => [
    resolves(m, 'hub', '172.30.0.10'),
    resolves(m, 'example.com', '172.30.0.60'),
    resolves(m, 'example.org', 'nothing'),
  ])))
  report(`Fresh machines, ready to install on${when}`, await Promise.all(Object.keys(fresh).flatMap((m) => [hostKey(m), installs(m)])))
}

await checkEverything('')

// Any machine, restarted, comes back as it was, and so does everything around it.
for (const m of names) {
  await must('docker', 'restart', m)
  await must('docker', 'compose', 'up', '-d', '--wait')
  await checkEverything(`, after restarting ${m}`)
}

console.log(`\n${total - failures.length} of ${total} passed`)
for (const failure of failures) {
  console.log(`  ${failure}`)
}
process.exitCode = failures.length ? 1 : 0
