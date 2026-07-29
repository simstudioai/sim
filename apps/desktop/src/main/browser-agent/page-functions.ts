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
 *
 * Several functions repeat an identical `isSecretField` helper. That
 * duplication is required, not accidental: self-containment means a shared
 * module-level helper would not survive serialization. It matches on
 * `tagName`/`type`/`autocomplete` rather than `instanceof HTMLInputElement`
 * because element wrappers are realm-bound — an input reached through a
 * same-origin iframe belongs to that frame's realm, so `instanceof` against
 * the top frame's constructor returns false and would skip the check on
 * exactly the nested login forms that need it most.
 */

declare global {
  interface Window {
    __simAgentElements?: Element[]
  }
}

/**
 * Builds the page snapshot: a structural outline (headings, landmarks) with
 * interactive elements carrying numeric ids, walking open shadow roots and
 * same-origin iframes. Rebuilds the element registry as a side effect.
 */
export function collectSnapshot(): unknown {
  const refCap = 300
  const lineCap = 600
  // Surrogate-safe truncation: plain slice() cuts by UTF-16 code units and
  // can split an astral character (emoji, 𝐛𝐨𝐥𝐝 text), leaving a lone high
  // surrogate that is invalid JSON downstream (Postgres jsonb rejects it).
  const cut = (s: string, n: number): string => {
    const out = s.slice(0, n)
    const last = out.charCodeAt(out.length - 1)
    return last >= 0xd800 && last <= 0xdbff ? out.slice(0, -1) : out
  }
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

  const isSecretField = (el: Element | null): boolean => {
    if (!el || el.tagName !== 'INPUT') return false
    if (String((el as HTMLInputElement).type || '').toLowerCase() === 'password') return true
    // A reveal toggle flips the field to type="text" without making its
    // contents any less secret, and some forms never use type="password" at
    // all. The autocomplete token is the page's own declaration either way.
    // Space-separated detail tokens are spec-legal and WebAuthn recommends
    // `current-password webauthn`, so whole-string equality missed real values
    // on exactly the type=text credential fields where autocomplete is the
    // only signal there is.
    const hint = String(el.getAttribute('autocomplete') || '').toLowerCase()
    return hint
      .split(/\s+/)
      .some((token) => token === 'current-password' || token === 'new-password')
  }

  /**
   * Fields whose value is as sensitive as a password but which the agent must
   * still be able to FILL: one-time codes and payment details.
   *
   * Deliberately separate from isSecretField. That one also gates keystrokes
   * (activeElementSecrecy feeds the driver's press-key guard), so folding these
   * tokens into it would stop the agent completing a checkout or an OTP prompt —
   * work it is legitimately asked to do. Only the value is withheld here.
   */
  const isSensitiveValueField = (el: Element | null): boolean => {
    if (!el || el.tagName !== 'INPUT') return false
    const hint = String(el.getAttribute('autocomplete') || '').toLowerCase()
    return hint
      .split(/\s+/)
      .some(
        (token) =>
          token === 'one-time-code' ||
          token === 'cc-number' ||
          token === 'cc-csc' ||
          token === 'cc-exp' ||
          token === 'cc-exp-month' ||
          token === 'cc-exp-year'
      )
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
    return cut(name.replace(/\s+/g, ' ').trim(), 120)
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
    if (isSecretField(el)) {
      role = 'password-field'
    } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      // Tag comparison so fields inside same-origin iframes report their value
      // like any other. Redaction above is realm-safe and runs first, so
      // widening this cannot expose a credential field.
      const value = (el as HTMLInputElement).value
      if (value && isSensitiveValueField(el)) parts.push('value-withheld')
      else if (value) parts.push(`value="${cut(String(value), 120)}"`)
    }
    if (el.tagName === 'A') {
      const href = el.getAttribute('href')
      if (href) parts.push(`href="${cut(href, 200)}"`)
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
    const label = cut((el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(), 80)
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
          const text = cut(((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim(), 160)
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
  const isSecretField = (node: Element | null): boolean => {
    if (!node || node.tagName !== 'INPUT') return false
    if (String((node as HTMLInputElement).type || '').toLowerCase() === 'password') return true
    const hint = String(node.getAttribute('autocomplete') || '').toLowerCase()
    return hint
      .split(/\s+/)
      .some((token) => token === 'current-password' || token === 'new-password')
  }

  const el = (window.__simAgentElements || [])[id]
  if (!el || !el.isConnected) return { error: 'stale' }
  // Clicking focuses, and a focused credential field is the one state in
  // which subsequent keystrokes would land in a password. Refusing the click
  // keeps that state unreachable rather than relying on every later keyboard
  // path to re-check.
  if (isSecretField(el)) return { error: 'password' }
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
  // Duck-typed rather than `instanceof HTMLElement`: an element reached
  // through a same-origin iframe belongs to that frame's realm, so the check
  // is false there and the click would skip focus entirely.
  const html = el as HTMLElement
  el.dispatchEvent(new PointerEvent('pointerdown', opts))
  el.dispatchEvent(new MouseEvent('mousedown', opts))
  if (typeof html.focus === 'function') html.focus()
  el.dispatchEvent(new PointerEvent('pointerup', opts))
  el.dispatchEvent(new MouseEvent('mouseup', opts))
  if (typeof html.click === 'function') html.click()
  else el.dispatchEvent(new MouseEvent('click', opts))
  const label = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  // Drop a trailing lone high surrogate the slice may have created.
  return { clicked: true, element: label.replace(/[\uD800-\uDBFF]$/, '') }
}

/**
 * Prepares an element for NATIVE typing (driver-side CDP `Input.insertText`):
 * focuses it and selects its current content so the inserted text REPLACES
 * what's there — including inside code editors (CodeMirror/Monaco), whose
 * models sync from the DOM selection / native input pipeline.
 */
export function focusElementForTyping(id: number): unknown {
  const isSecretField = (node: Element | null): boolean => {
    if (!node || node.tagName !== 'INPUT') return false
    if (String((node as HTMLInputElement).type || '').toLowerCase() === 'password') return true
    const hint = String(node.getAttribute('autocomplete') || '').toLowerCase()
    return hint
      .split(/\s+/)
      .some((token) => token === 'current-password' || token === 'new-password')
  }

  const el = (window.__simAgentElements || [])[id]
  if (!el || !el.isConnected) return { error: 'stale' }
  el.scrollIntoView({ block: 'center' })

  if (isSecretField(el)) {
    return { error: 'password' }
  }

  // Tag comparisons, not `instanceof`: element wrappers are realm-bound, so an
  // input inside a same-origin iframe — a framed login form, a TinyMCE body —
  // fails every `instanceof` against the top frame's constructors and would be
  // reported back as "not a text input".
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    const field = el as HTMLInputElement | HTMLTextAreaElement
    field.focus()
    field.select()
    return { focused: true, kind: tag === 'INPUT' ? 'input' : 'textarea' }
  }

  // Editors often register a wrapper as the interactive element while the
  // actual editable surface is a descendant.
  const editable = (el as HTMLElement).isContentEditable
    ? (el as HTMLElement)
    : el.querySelector<HTMLElement>('[contenteditable="true"], [contenteditable=""]')
  if (editable) {
    editable.focus()
    const selection = editable.ownerDocument.defaultView?.getSelection()
    if (selection) {
      const range = editable.ownerDocument.createRange()
      range.selectNodeContents(editable)
      selection.removeAllRanges()
      selection.addRange(range)
    }
    return { focused: true, kind: 'contenteditable' }
  }
  return { error: 'not-editable' }
}

/**
 * Reads back the focused element's state after a native key/type action so
 * the driver can report what actually happened instead of assuming success.
 */
export function readActiveElementState(): unknown {
  const isSecretField = (node: Element | null): boolean => {
    if (!node || node.tagName !== 'INPUT') return false
    if (String((node as HTMLInputElement).type || '').toLowerCase() === 'password') return true
    const hint = String(node.getAttribute('autocomplete') || '').toLowerCase()
    return hint
      .split(/\s+/)
      .some((token) => token === 'current-password' || token === 'new-password')
  }

  /** Sensitive-but-fillable fields; see collectSnapshot's copy for why. */
  const isSensitiveValueField = (node: Element | null): boolean => {
    if (!node || node.tagName !== 'INPUT') return false
    const hint = String(node.getAttribute('autocomplete') || '').toLowerCase()
    return hint
      .split(/\s+/)
      .some(
        (token) =>
          token === 'one-time-code' ||
          token === 'cc-number' ||
          token === 'cc-csc' ||
          token === 'cc-exp' ||
          token === 'cc-exp-month' ||
          token === 'cc-exp-year'
      )
  }

  // Focus inside a frame or an open shadow root surfaces on the outer document
  // as the host element, so descend to find what is really focused.
  let active = document.activeElement as HTMLElement | null
  for (let depth = 0; active && depth < 10; depth++) {
    const shadow = active.shadowRoot
    if (shadow?.activeElement) {
      active = shadow.activeElement as HTMLElement
      continue
    }
    // Upper-cased for the same reason as in activeElementSecrecy: tagName is
    // lower-case for HTML elements in an XHTML document.
    if (
      String(active.tagName || '').toUpperCase() === 'IFRAME' ||
      String(active.tagName || '').toUpperCase() === 'FRAME'
    ) {
      try {
        const inner = (active as HTMLIFrameElement).contentDocument
        if (inner?.activeElement && inner.activeElement !== inner.body) {
          active = inner.activeElement as HTMLElement
          continue
        }
      } catch {
        // Cross-origin frame — not inspectable, report the frame itself.
      }
    }
    break
  }

  if (!active || active === active.ownerDocument.body) {
    return { activeElement: 'body', selectedChars: 0, valueLength: 0, valuePreview: '' }
  }
  // Length and selection size are withheld along with the value: both are
  // observations of a secret the agent is never allowed to learn.
  if (isSecretField(active)) {
    return {
      activeElement: 'password-field',
      selectedChars: 0,
      valueLength: 0,
      valuePreview: '',
      redacted: true,
    }
  }
  // Only the preview is withheld, and the real tag is kept: the agent is allowed
  // to fill these, so it still needs the readback this function exists for.
  // Zeroing valueLength told it the field was empty after a successful type, and
  // the natural next move is to type again — a doubled OTP or card number.
  // A length is not a disclosure here; 6 and 16 are properties of the format.
  if (isSensitiveValueField(active)) {
    const field = active as HTMLInputElement
    const current = String(field.value ?? '')
    return {
      activeElement: active.tagName.toLowerCase(),
      selectedChars: Math.abs((field.selectionEnd ?? 0) - (field.selectionStart ?? 0)),
      valueLength: current.length,
      valuePreview: '',
      redacted: true,
    }
  }
  let value = ''
  let selectedChars = 0
  const activeTag = String(active.tagName || '').toUpperCase()
  if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') {
    const field = active as HTMLInputElement | HTMLTextAreaElement
    value = field.value
    selectedChars = Math.abs((field.selectionEnd ?? 0) - (field.selectionStart ?? 0))
  } else {
    value = active.innerText || active.textContent || ''
    selectedChars = window.getSelection()?.toString().length ?? 0
  }
  return {
    activeElement: active.tagName.toLowerCase(),
    selectedChars,
    valueLength: value.length,
    // Trailing regex drops a lone high surrogate the slice may have created.
    valuePreview: value
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120)
      .replace(/[\uD800-\uDBFF]$/, ''),
  }
}

/**
 * Classifies what currently holds focus, for the driver's pre-dispatch check
 * on trusted CDP key events (which bypass the page entirely and land on
 * whatever is focused, so this cannot be enforced from inside the page alone):
 *
 * - `secret` — a credential field. No keystroke belongs here.
 * - `opaque` — a cross-origin frame we cannot inspect, so a credential field
 *   cannot be ruled out. Character insertion is refused; caret movement and
 *   Escape are not.
 * - `safe` — anything we can see and that is not a credential field.
 */
export function activeElementSecrecy(): string {
  const isSecretField = (node: Element | null): boolean => {
    if (!node || node.tagName !== 'INPUT') return false
    if (String((node as HTMLInputElement).type || '').toLowerCase() === 'password') return true
    const hint = String(node.getAttribute('autocomplete') || '').toLowerCase()
    return hint
      .split(/\s+/)
      .some((token) => token === 'current-password' || token === 'new-password')
  }

  let active = document.activeElement as HTMLElement | null
  for (let depth = 0; active && depth < 10; depth++) {
    if (isSecretField(active)) return 'secret'
    const shadow = active.shadowRoot
    if (shadow?.activeElement) {
      active = shadow.activeElement as HTMLElement
      continue
    }
    // A CLOSED shadow root reports `shadowRoot === null` by design and cannot
    // be traversed from script, while focus inside it retargets to the HOST —
    // whose tagName is never INPUT, so the fallthrough below would call it
    // 'safe' and let a trusted CDP keystroke land on a password field the page
    // has hidden from us. Sequential focus navigation crosses closed boundaries
    // natively, so Tab alone is enough to get there. Treated like a
    // cross-origin frame: not inspectable is not safe.
    //
    // Detected by focusability rather than by tag: `attachShadow` accepts plain
    // div/span/section as well as custom elements, so a tag test would miss
    // half of them. An element that is not focusable in its own right cannot be
    // `activeElement` unless focus was retargeted out of a shadow tree, which
    // makes "not focusable yet focused" the reliable signal. Frames stay out of
    // it so the branch below still classifies them.
    // Tag compared upper-cased: tagName preserves case outside the HTML
    // namespace and is lower-case for HTML elements in an XHTML document, where
    // every comparison below would otherwise miss.
    const tag = String(active.tagName || '').toUpperCase()
    // RESIDUAL, stated rather than papered over: `tabindex` and
    // `contenteditable` exempt an element even on a shadow-capable tag, so a
    // host carrying either — `<div tabindex="0">` with a closed root — still
    // reports 'safe'. A closed root is indistinguishable from no root at all
    // (that is what `mode: 'closed'` buys the page), and `<div tabindex="0">`
    // buttons and menu items are everywhere, so refusing them would block Enter
    // and Space on ordinary pages to close a targeted case. The only reliable
    // detector is `attachShadow` throwing, which is destructive. Narrowing this
    // needs the driver to stop trusting a page-derived signal, not a better
    // guess here.
    const FOCUSABLE_TAGS = [
      'INPUT',
      'TEXTAREA',
      'SELECT',
      'BUTTON',
      'A',
      'AREA',
      'SUMMARY',
      'DIALOG',
      'VIDEO',
      'AUDIO',
      'EMBED',
      'OBJECT',
      'IFRAME',
      'FRAME',
    ]
    const focusableItself =
      active === active.ownerDocument.body ||
      active.isContentEditable ||
      active.hasAttribute('tabindex') ||
      FOCUSABLE_TAGS.indexOf(tag) !== -1
    if (!shadow && !focusableItself) return 'opaque'
    if (tag === 'IFRAME' || tag === 'FRAME') {
      let inner: Document | null = null
      try {
        inner = (active as HTMLIFrameElement).contentDocument
      } catch {
        return 'opaque'
      }
      // A same-origin frame yields a document; a cross-origin one yields null.
      if (!inner) return 'opaque'
      if (inner.activeElement && inner.activeElement !== inner.body) {
        active = inner.activeElement as HTMLElement
        continue
      }
    }
    break
  }
  return isSecretField(active) ? 'secret' : 'safe'
}

export function typeIntoElement(id: number, text: string, submit: boolean): unknown {
  const isSecretField = (node: Element | null): boolean => {
    if (!node || node.tagName !== 'INPUT') return false
    if (String((node as HTMLInputElement).type || '').toLowerCase() === 'password') return true
    const hint = String(node.getAttribute('autocomplete') || '').toLowerCase()
    return hint
      .split(/\s+/)
      .some((token) => token === 'current-password' || token === 'new-password')
  }

  const el = (window.__simAgentElements || [])[id]
  if (!el || !el.isConnected) return { error: 'stale' }
  el.scrollIntoView({ block: 'center' })

  if (isSecretField(el)) {
    return { error: 'password' }
  }

  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    const field = el as HTMLInputElement | HTMLTextAreaElement
    field.focus()
    // The native setter must come from the element's OWN realm. A same-origin
    // iframe has its own constructors, and calling the top frame's setter on
    // one of its nodes throws "Illegal invocation".
    const view = el.ownerDocument.defaultView ?? window
    const proto =
      tag === 'INPUT' ? view.HTMLInputElement.prototype : view.HTMLTextAreaElement.prototype
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
    if (descriptor?.set) descriptor.set.call(field, text)
    else field.value = text
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
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
  const isSecretField = (node: Element | null): boolean => {
    if (!node || node.tagName !== 'INPUT') return false
    if (String((node as HTMLInputElement).type || '').toLowerCase() === 'password') return true
    const hint = String(node.getAttribute('autocomplete') || '').toLowerCase()
    return hint
      .split(/\s+/)
      .some((token) => token === 'current-password' || token === 'new-password')
  }

  const target = (document.activeElement as HTMLElement | null) ?? document.body
  // The driver checks focus before taking the trusted CDP path; this covers
  // the synthetic fallback, which is reached independently when CDP is down.
  if (isSecretField(target)) return { error: 'password' }
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
  if (el.tagName !== 'SELECT') return { error: 'not-select' }
  const select = el as HTMLSelectElement
  const wanted = value.trim().toLowerCase()
  const option = Array.from(select.options).find(
    (o) => o.value.trim().toLowerCase() === wanted || o.label.trim().toLowerCase() === wanted
  )
  if (!option) {
    return {
      error: 'no-option',
      options: Array.from(select.options)
        .slice(0, 50)
        .map((o) => o.label.trim()),
    }
  }
  select.value = option.value
  select.dispatchEvent(new Event('input', { bubbles: true }))
  select.dispatchEvent(new Event('change', { bubbles: true }))
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
    // Trailing regex drops a lone high surrogate the slice may have created.
    text: trimmed.slice(0, maxChars).replace(/[\uD800-\uDBFF]$/, ''),
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
