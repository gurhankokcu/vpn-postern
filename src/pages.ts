import { address, port, type Node } from './data.ts'

const mark = `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
<path d="M4 28V11l12-7 12 7v17" stroke="url(#g)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M12 28v-8a4 4 0 0 1 8 0v8" stroke="url(#g)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="16" cy="21" r="1.5" fill="#37d4c4"/>
<defs><linearGradient id="g" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
<stop stop-color="#37d4c4"/><stop offset="1" stop-color="#6f8ff8"/>
</linearGradient></defs>
</svg>`

const brand = `<div class="brand">${mark}<b>VPN <span>Postern</span></b></div>`

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

function page(title: string, body: string, className = '') {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · VPN Postern</title>
<link rel="stylesheet" href="/style.css">
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

export function nodesPage(nodes: Node[]) {
  const rows = nodes.map((node) => `<tr>
<td><b>${escapeHtml(node.name)}</b></td>
<td class="mono">${address(node)}</td>
<td class="mono">${port(node)}</td>
</tr>`).join('')

  const body = nodes.length
    ? `<table><thead><tr><th>Name</th><th>Address</th><th>Port</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div class="empty"><h3>No nodes yet</h3><p>Add a node to give it a tunnel to this hub.</p></div>`

  return layout('Nodes', `<section class="card">
<div class="card-head">
<h2>Nodes</h2><span class="pill">${nodes.length} total</span>
</div>
${body}
</section>`)
}

export function notFoundPage() {
  return layout('Not found', `<section class="card"><div class="empty"><h3>Not found</h3></div></section>`)
}
