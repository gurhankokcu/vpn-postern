#!/usr/bin/env node
import { createServer } from 'node:http'

createServer((req, res) => {
  const client = req.socket.remoteAddress
  console.log(`${client} ${req.method} ${req.url}`)
  res.writeHead(200, { 'content-type': 'application/json' }).end(`${JSON.stringify({ server: process.env.SITE, client })}\n`)
}).listen(80, '0.0.0.0')
