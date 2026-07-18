/**
 * Functions injected into automated pages via `webContents.executeJavaScript`.
 * The driver serializes each function's source (`String(fn)`) and calls it
 * with JSON-encoded arguments, so every function here MUST be fully
 * self-contained: no imports, no closed-over variables, only its own
 * arguments and page globals. Helpers live INSIDE the function that uses them.
 *
 * The element registry (`window.__simAgentElements`) is rebuilt by every
 * snapshot and naturally cleared by navigation; interaction functions treat a
 * missing or disconnected entry as a stale id.
 */

declare global {
  interface Window {
    __simAgentElements?: Element[]
  }
}

export interface PageActionError {
  error: string
}

/**
 * Builds the page snapshot: a structural outline (headings, landmarks) with
 * interactive elements carrying numeric ids, walking open shadow roots and
 * same-origin iframes. Rebuilds the element registry as a side effect.
 */
export function collectSnapshot(): unknown {
  const refCap = 300
  const lineCap = 600
  const interactiveSelector = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    'summary',
    '[role="button"]',
    '[role="link"]',
    '[role="textbox"]',
    '[role="searchbox"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="combobox"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="tab"]',
    '[role="switch"]',
    '[role="option"]',
    '[role="slider"]',
    '[onclick]',
    '[contenteditable="true"]',
    '[contenteditable=""]',
  ].join(', ')
  const landmarkSelector = [
    'nav',
    'main',
    'header',
    'footer',
    'aside',
    'dialog',
    '[role="navigation"]',
    '[role="main"]',
    '[role="banner"]',
    '[role="contentinfo"]',
    '[role="complementary"]',
    '[role="search"]',
    '[role="dialog"]',
    '[role="form"]',
  ].join(', ')

  const registry: Element[] = []
  window.__simAgentElements = registry
  const lines: string[] = []
  let truncated = false

  const isVisible = (el: Element): boolean => {
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    const doc = el.ownerDocument
    const win = doc.defaultView
    if (!win) return false
    const style = win.getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none'
  }

  const roleFor = (el: Element): string => {
    const explicit = el.getAttribute('role')
    if (explicit) return explicit
    const tag = el.tagName
    if (tag === 'A') return 'link'
    if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button'
    if (tag === 'SELECT') return 'combobox'
    if (tag === 'TEXTAREA') return 'textbox'
    if (tag === 'INPUT') {
      const type = (el as HTMLInputElement).type
      if (type === 'checkbox') return 'checkbox'
      if (type === 'radio') return 'radio'
      if (type === 'submit' || type === 'button' || type === 'reset') return 'button'
      return 'textbox'
    }
    if ((el as HTMLElement).isContentEditable) return 'textbox'
    return 'clickable'
  }

  const nameFor = (el: Element): string => {
    let name = el.getAttribute('aria-label') || ''
    if (!name) {
      const labels = (el as HTMLInputElement).labels
      if (labels && labels.length > 0) name = labels[0].innerText || ''
    }
    if (!name) name = (el as HTMLElement).innerText || ''
    if (!name) {
      name =
        el.getAttribute('placeholder') ||
        el.getAttribute('title') ||
        el.getAttribute('alt') ||
        el.getAttribute('name') ||
        ''
    }
    return name.replace(/\s+/g, ' ').trim().slice(0, 120)
  }

  const push = (line: string): boolean => {
    if (lines.length >= lineCap) {
      truncated = true
      return false
    }
    lines.push(line)
    return true
  }

  const emitInteractive = (el: Element, indent: string): void => {
    if (registry.length >= refCap) {
      truncated = true
      return
    }
    const id = registry.length
    registry.push(el)
    let role = roleFor(el)
    const parts: string[] = []
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
    ) {
      const isPassword = el instanceof HTMLInputElement && el.type === 'password'
      if (isPassword) role = 'password-field'
      else if (el.value) parts.push(`value="${String(el.value).slice(0, 120)}"`)
    }
    if (el.tagName === 'A') {
      const href = el.getAttribute('href')
      if (href) parts.push(`href="${href.slice(0, 200)}"`)
    }
    if ((el as HTMLInputElement).disabled === true) parts.push('disabled')
    if ((el as HTMLInputElement).checked === true) parts.push('checked')
    const suffix = parts.length > 0 ? ` ${parts.join(' ')}` : ''
    push(`${indent}- ${role} "${nameFor(el)}" [ref=${id}]${suffix}`)
  }

  const headingLevel = (el: Element): number | null => {
    const match = /^H([1-6])$/.exec(el.tagName)
    if (match) return Number(match[1])
    if (el.getAttribute('role') === 'heading') {
      const level = Number(el.getAttribute('aria-level') || '2')
      return Number.isFinite(level) ? level : 2
    }
    return null
  }

  const landmarkLabel = (el: Element): string => {
    const role = el.getAttribute('role')
    const tag = el.tagName.toLowerCase()
    const kind =
      role ||
      (tag === 'nav'
        ? 'navigation'
        : tag === 'header'
          ? 'banner'
          : tag === 'footer'
            ? 'contentinfo'
            : tag === 'aside'
              ? 'complementary'
              : tag)
    const label = (el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80)
    return label ? `${kind} "${label}"` : kind
  }

  const walk = (root: ParentNode, depth: number): void => {
    if (truncated && registry.length >= refCap) return
    for (const el of Array.from(root.children)) {
      if (registry.length >= refCap && lines.length >= lineCap) return
      const tag = el.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') continue

      const indent = '  '.repeat(depth)
      let childDepth = depth

      if (el.matches(landmarkSelector) && isVisible(el)) {
        if (!push(`${indent}- ${landmarkLabel(el)}:`)) return
        childDepth = depth + 1
      } else {
        const level = headingLevel(el)
        if (level !== null && isVisible(el)) {
          const text = ((el as HTMLElement).innerText || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 160)
          if (text) push(`${indent}- heading "${text}" (h${level})`)
        } else if (el.matches(interactiveSelector) && isVisible(el)) {
          emitInteractive(el, indent)
          // Interactive containers rarely nest other interactives; still
          // recurse so e.g. a clickable card exposes its inner links.
        }
      }

      if (tag === 'IFRAME' || tag === 'FRAME') {
        try {
          const innerDoc = (el as HTMLIFrameElement).contentDocument
          if (innerDoc?.body && isVisible(el)) {
            if (!push(`${indent}- iframe:`)) return
            walk(innerDoc.body, childDepth + 1)
          }
        } catch {
          // Cross-origin iframe — not readable.
        }
        continue
      }

      const shadow = (el as HTMLElement).shadowRoot
      if (shadow) walk(shadow, childDepth)
      walk(el, childDepth)
    }
  }

  if (document.body) walk(document.body, 0)

  return {
    url: window.location.href,
    title: document.title,
    outline: lines.join('\n'),
    truncated,
    scrollY: Math.round(window.scrollY),
    pageHeight: Math.round(document.documentElement.scrollHeight),
    viewportHeight: window.innerHeight,
  }
}

export function clickElement(id: number): unknown {
  const el = (window.__simAgentElements || [])[id]
  if (!el || !el.isConnected) return { error: 'stale' }
  el.scrollIntoView({ block: 'center', inline: 'center' })
  const rect = el.getBoundingClientRect()
  const opts = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: rect.x + rect.width / 2,
    clientY: rect.y + rect.height / 2,
    button: 0,
  }
  el.dispatchEvent(new PointerEvent('pointerdown', opts))
  el.dispatchEvent(new MouseEvent('mousedown', opts))
  if (el instanceof HTMLElement) el.focus()
  el.dispatchEvent(new PointerEvent('pointerup', opts))
  el.dispatchEvent(new MouseEvent('mouseup', opts))
  if (el instanceof HTMLElement) el.click()
  else el.dispatchEvent(new MouseEvent('click', opts))
  const label = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return { clicked: true, element: label }
}

export function typeIntoElement(id: number, text: string, submit: boolean): unknown {
  const el = (window.__simAgentElements || [])[id]
  if (!el || !el.isConnected) return { error: 'stale' }
  el.scrollIntoView({ block: 'center' })

  if (el instanceof HTMLInputElement && el.type === 'password') {
    return { error: 'password' }
  }

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus()
    const proto =
      el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
    if (descriptor?.set) descriptor.set.call(el, text)
    else el.value = text
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  } else if ((el as HTMLElement).isContentEditable) {
    const editable = el as HTMLElement
    editable.focus()
    editable.textContent = text
    editable.dispatchEvent(
      new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' })
    )
  } else {
    return { error: 'not-editable' }
  }

  if (submit) {
    const key = {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
    }
    const notCancelled = el.dispatchEvent(new KeyboardEvent('keydown', key))
    el.dispatchEvent(new KeyboardEvent('keyup', key))
    const form = (el as HTMLInputElement).form ?? (el as HTMLElement).closest?.('form') ?? null
    if (notCancelled && form) {
      if (typeof form.requestSubmit === 'function') form.requestSubmit()
      else form.submit()
    }
  }
  return { typed: true, submitted: submit === true }
}

export function pressKeyOnPage(
  key: string,
  code: string,
  keyCode: number,
  ctrl: boolean,
  meta: boolean,
  shift: boolean,
  alt: boolean
): unknown {
  const target = (document.activeElement as HTMLElement | null) ?? document.body
  const opts = {
    bubbles: true,
    cancelable: true,
    key,
    code,
    keyCode,
    which: keyCode,
    ctrlKey: ctrl,
    metaKey: meta,
    shiftKey: shift,
    altKey: alt,
  }
  target.dispatchEvent(new KeyboardEvent('keydown', opts))
  target.dispatchEvent(new KeyboardEvent('keyup', opts))
  return { pressed: key, target: target.tagName.toLowerCase() }
}

export function scrollPage(direction: string, amount?: number): unknown {
  const distance = typeof amount === 'number' && amount > 0 ? amount : window.innerHeight * 0.85
  window.scrollBy({ top: direction === 'up' ? -distance : distance, behavior: 'instant' })
  const scrollY = Math.round(window.scrollY)
  const pageHeight = Math.round(document.documentElement.scrollHeight)
  return {
    scrollY,
    pageHeight,
    atTop: scrollY <= 0,
    atBottom: scrollY + window.innerHeight >= pageHeight - 2,
  }
}

export function selectOptionInElement(id: number, value: string): unknown {
  const el = (window.__simAgentElements || [])[id]
  if (!el || !el.isConnected) return { error: 'stale' }
  if (!(el instanceof HTMLSelectElement)) return { error: 'not-select' }
  const wanted = value.trim().toLowerCase()
  const option = Array.from(el.options).find(
    (o) => o.value.trim().toLowerCase() === wanted || o.label.trim().toLowerCase() === wanted
  )
  if (!option) {
    return {
      error: 'no-option',
      options: Array.from(el.options)
        .slice(0, 50)
        .map((o) => o.label.trim()),
    }
  }
  el.value = option.value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return { selected: option.label.trim() }
}

export function hoverElement(id: number): unknown {
  const el = (window.__simAgentElements || [])[id]
  if (!el || !el.isConnected) return { error: 'stale' }
  el.scrollIntoView({ block: 'center' })
  const rect = el.getBoundingClientRect()
  const opts = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: rect.x + rect.width / 2,
    clientY: rect.y + rect.height / 2,
  }
  el.dispatchEvent(new PointerEvent('pointerover', opts))
  el.dispatchEvent(new PointerEvent('pointerenter', opts))
  el.dispatchEvent(new MouseEvent('mouseover', opts))
  el.dispatchEvent(new MouseEvent('mouseenter', opts))
  el.dispatchEvent(new PointerEvent('pointermove', opts))
  el.dispatchEvent(new MouseEvent('mousemove', opts))
  return { hovered: true }
}

export function readPageText(id?: number): unknown {
  const maxChars = 30000
  let text: string
  if (typeof id === 'number') {
    const el = (window.__simAgentElements || [])[id]
    if (!el || !el.isConnected) return { error: 'stale' }
    text = (el as HTMLElement).innerText ?? el.textContent ?? ''
  } else {
    text = document.body?.innerText ?? ''
  }
  const trimmed = text.replace(/\n{3,}/g, '\n\n').trim()
  return {
    url: window.location.href,
    title: document.title,
    text: trimmed.slice(0, maxChars),
    truncated: trimmed.length > maxChars,
  }
}

export function pageContainsText(text: string): boolean {
  return Boolean(document.body?.innerText.includes(text))
}

export function getViewportInfo(): unknown {
  return {
    url: window.location.href,
    title: document.title,
    width: window.innerWidth,
    height: window.innerHeight,
  }
}
