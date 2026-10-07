// A modal is open when its page loads: showing it as a modal gives it a backdrop and traps
// focus, and closing it puts the address back to the tree it sits on.
const dialog = document.querySelector('dialog')
if (dialog) {
  dialog.close()
  dialog.showModal()
  // The close event from close() above arrives later, when the modal is open again.
  dialog.addEventListener('close', () => {
    if (!dialog.open) {
      history.replaceState(null, '', '/')
    }
  })
}

// One label for every icon button, placed in the window rather than inside the button,
// so no card or dialog edge clips it.
const tip = document.createElement('div')
tip.className = 'tip'
let tipped = null

function showTip(button) {
  tipped = button
  ;(document.querySelector('dialog[open]') ?? document.body).append(tip)
  tip.textContent = button.getAttribute('aria-label')
  const rect = button.getBoundingClientRect()
  const left = rect.left + rect.width / 2 - tip.offsetWidth / 2
  tip.style.left = `${Math.min(Math.max(left, 8), innerWidth - tip.offsetWidth - 8)}px`
  tip.style.top = `${rect.top - tip.offsetHeight - 7}px`
}

for (const type of ['mouseover', 'focusin']) {
  document.addEventListener(type, (event) => {
    const button = event.target.closest('.act[aria-label]')
    if (button) {
      showTip(button)
    } else {
      tip.remove()
    }
  })
}
document.addEventListener('focusout', () => tip.remove())
document.addEventListener('scroll', () => tip.remove(), true)

function label(button, text) {
  button.setAttribute('aria-label', text)
  if (tip.isConnected && tipped === button) {
    showTip(button)
  }
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy]')
  if (!button || button.getAttribute('aria-label') !== 'Copy') {
    return
  }
  const icon = button.innerHTML
  try {
    await navigator.clipboard.writeText(button.closest('.code').querySelector('pre').textContent)
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
    label(button, 'Copied')
  } catch {
    label(button, 'Copy failed')
  }
  setTimeout(() => {
    button.innerHTML = icon
    label(button, 'Copy')
  }, 1500)
})

// Cmd+A inside a code box, or a fourth click on it, selects the whole box.
function selectAll(pre) {
  const range = document.createRange()
  range.selectNodeContents(pre)
  getSelection().removeAllRanges()
  getSelection().addRange(range)
}

document.addEventListener('mousedown', (event) => {
  const pre = event.target.closest('.code pre')
  if (pre && event.detail >= 4) {
    event.preventDefault()
    selectAll(pre)
  }
})

document.addEventListener('keydown', (event) => {
  const pre = event.target.closest?.('.code pre')
  if (pre && (event.metaKey || event.ctrlKey) && event.key === 'a') {
    event.preventDefault()
    selectAll(pre)
  }
})
