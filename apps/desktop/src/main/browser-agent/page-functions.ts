/**
 * Functions injected into automated pages via `webContents.executeJavaScript`.
 * The driver serializes each function's source (`String(fn)`) and calls it
 * with JSON-encoded arguments, so every function here MUST be fully
 * self-contained: no imports, no closed-over variables, only its own
 * arguments and page globals. Helpers live INSIDE the function that uses them.
 *
 * The element registry (`window.__simAgentElements`) is rebuilt by every
 * snapshot and naturally cleared by navigation. A snapshot also installs a
 * semantic resolver that can recover a ref when React replaces the same
 * logical control with a new DOM node; navigation and ambiguous matches still
 * make the ref stale.
 *
 * Several functions repeat an identical `isSecretField` helper. That
 * duplication is required, not accidental: self-containment means a shared
 * module-level helper would not survive serialization. It matches on
 * `tagName`/`type`/`autocomplete` rather than `instanceof HTMLInputElement`
 * because element wrappers are realm-bound — an input reached through a
 * same-origin iframe belongs to that frame's realm, so `instanceof` against
 * the top frame's constructor returns false and would skip the check on
 * exactly the nested login forms that need it most.
 *
 * Every tag comparison here is upper-cased. `tagName` is lower-case for HTML
 * elements in an XHTML document, and a raw compare there reports every
 * credential field as ordinary — failing open on both the value redaction and
 * the keystroke refusal that read it.
 */

declare global {
  interface Window {
    __simAgentElements?: Element[]
    __simAgentResolveElement?: (id: number) => { element: Element; recovered: boolean } | null
    __simAgentMutationStates?: Array<{
      root: Node
      observer: MutationObserver
      revision: number
      /** Roots already passed to observe(), so re-observing stays cheap. */
      observedRoots: WeakSet<ParentNode>
    }>
    __simAgentNextElementId?: number
    /** Why the last __simAgentResolveElement call returned null — read by the
     * shared stale-error producers so a refusal names its cause instead of
     * the blanket "the page changed". Cleared on every successful resolve. */
    __simAgentStaleReason?: string
  }
}

/**
 * Builds the page snapshot: a structural outline (headings, landmarks) with
 * interactive elements carrying numeric ids, walking open shadow roots and
 * same-origin iframes. Rebuilds the element registry as a side effect.
 */
export function collectSnapshot(startingElementId = 0): unknown {
  const refCap = 300
  const lineCap = 600
  const nodeCap = 12_000
  const depthCap = 100
  // Surrogate-safe truncation: plain slice() cuts by UTF-16 code units and
  // can split an astral character (emoji, 𝐛𝐨𝐥𝐝 text), leaving a lone high
  // surrogate that is invalid JSON downstream (Postgres jsonb rejects it).
  const cut = (s: string, n: number): string => {
    let out = ''
    for (let index = 0; index < s.length && out.length < n; index++) {
      const code = s.charCodeAt(index)
      if (code === 0) {
        out += '\uFFFD'
        continue
      }
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = s.charCodeAt(index + 1)
        if (next >= 0xdc00 && next <= 0xdfff) {
          if (out.length + 2 > n) break
          out += s[index] + s[index + 1]
          index++
        } else {
          out += '\uFFFD'
        }
        continue
      }
      out += code >= 0xdc00 && code <= 0xdfff ? '\uFFFD' : s[index]
    }
    return out
  }
  // Keep page-controlled text from becoming indistinguishable from the
  // structural ref token consumed by the native driver. The zero-width break
  // is model-readable but prevents a literal label such as "[ref=4]" from
  // invalidating or impersonating the line's real element marker.
  const quote = (value: string): string => JSON.stringify(value.replace(/\[ref=/g, '[ref\u200B='))
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
    '[role="treeitem"]',
    '[role="gridcell"]',
    '[role="row"]',
    '[role="listitem"]',
    '[tabindex]',
    '[onclick]',
    '[contenteditable="true"]',
    '[contenteditable=""]',
    '[contenteditable="plaintext-only"]',
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
  const refLineIndexes: Record<number, number> = {}
  const locators: Array<{
    url: string
    tag: string
    role: string
    name: string
    attributes: Record<string, string>
    ancestor: string
    context: string
  }> = []
  window.__simAgentElements = registry
  const lines: string[] = []
  let truncated = false
  let refCount = 0
  let textRefCount = 0
  const textRefCap = 120
  let visitedNodes = 0
  const previousElementId = window.__simAgentNextElementId
  const safePreviousElementId =
    typeof previousElementId === 'number' &&
    Number.isSafeInteger(previousElementId) &&
    previousElementId >= 0
      ? previousElementId
      : 0
  const safeStartingElementId =
    Number.isSafeInteger(startingElementId) && startingElementId >= 0 ? startingElementId : 0
  let nextElementId = Math.max(safePreviousElementId, safeStartingElementId)

  const visibility = new WeakMap<Element, boolean>()

  const isVisible = (el: Element): boolean => {
    const cached = visibility.get(el)
    if (cached !== undefined) return cached
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      visibility.set(el, false)
      return false
    }
    const doc = el.ownerDocument
    const win = doc.defaultView
    if (!win) {
      visibility.set(el, false)
      return false
    }
    let visible = true
    for (let current: Element | null = el; current && visible; ) {
      const currentView: Window | null = current.ownerDocument.defaultView
      const style = currentView?.getComputedStyle(current)
      const opacity = Number.parseFloat(style?.opacity || '1')
      visible = Boolean(
        style &&
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          style.contentVisibility !== 'hidden' &&
          (!Number.isFinite(opacity) || opacity > 0.01) &&
          !current.hasAttribute('hidden') &&
          current.getAttribute('aria-hidden') !== 'true'
      )
      if (current.parentElement) current = current.parentElement
      else {
        const root = current.getRootNode()
        current = 'host' in root ? (root.host as Element) : null
      }
    }
    visibility.set(el, visible)
    return visible
  }

  const pageUrlFor = (el: Element): string => {
    try {
      return el.ownerDocument.defaultView?.location.href || ''
    } catch {
      return ''
    }
  }

  const isSecretField = (el: Element | null): boolean => {
    // Upper-cased: tagName is lower-case for HTML elements in an XHTML
    // document, where a raw compare would report every credential field as
    // ordinary — failing open on both the value redaction and the keystroke
    // refusal that read this.
    if (!el || String(el.tagName || '').toUpperCase() !== 'INPUT') return false
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
    if (!el || String(el.tagName || '').toUpperCase() !== 'INPUT') return false
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
    if (explicit) {
      return cut(explicit.replace(/[^a-zA-Z0-9_-]+/g, '-'), 40) || 'clickable'
    }
    const tag = String(el.tagName || '').toUpperCase()
    if (tag === 'A') return 'link'
    if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button'
    if (tag === 'SELECT') return 'combobox'
    if (tag === 'TEXTAREA') return 'textbox'
    if (tag === 'INPUT') {
      const type = (el as HTMLInputElement).type
      if (type === 'file') return 'file-input'
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
      const labelledBy = (el.getAttribute('aria-labelledby') || '').trim().split(/\s+/)
      name = labelledBy
        .filter(Boolean)
        .map((id) => el.ownerDocument.getElementById(id)?.textContent || '')
        .join(' ')
    }
    if (!name) {
      const labels = (el as HTMLInputElement).labels
      if (labels && labels.length > 0) name = labels[0].innerText || ''
    }
    if (!name) name = (el as HTMLElement).innerText || ''
    if (!name) name = el.textContent || ''
    if (!name) {
      name =
        el.getAttribute('placeholder') ||
        el.getAttribute('title') ||
        el.getAttribute('alt') ||
        el.getAttribute('name') ||
        ''
    }
    if (!name) {
      const labelledDescendant = el.querySelector(
        '[aria-label], img[alt], [title], svg title, [data-title], [data-emoji-name], [data-short-name], [data-name]'
      )
      name =
        labelledDescendant?.getAttribute('aria-label') ||
        labelledDescendant?.getAttribute('alt') ||
        labelledDescendant?.getAttribute('title') ||
        labelledDescendant?.getAttribute('data-title') ||
        labelledDescendant?.getAttribute('data-emoji-name') ||
        labelledDescendant?.getAttribute('data-short-name') ||
        labelledDescendant?.getAttribute('data-name') ||
        labelledDescendant?.textContent ||
        ''
    }
    if (!name) {
      name =
        el.getAttribute('data-emoji-name') ||
        el.getAttribute('data-short-name') ||
        el.getAttribute('data-name') ||
        el.getAttribute('data-title') ||
        el.getAttribute('data-qa') ||
        el.getAttribute('data-testid') ||
        el.getAttribute('data-test-id') ||
        ''
    }
    return cut(name.replace(/\s+/g, ' ').trim(), 120)
  }

  const locatorAttributes = (el: Element): Record<string, string> => {
    const result: Record<string, string> = {}
    for (const attribute of [
      'id',
      'name',
      'type',
      'href',
      'aria-label',
      'aria-labelledby',
      'placeholder',
      'title',
      'data-testid',
      'data-test-id',
      'data-qa',
      'data-key',
      'data-index',
      'data-emoji-name',
      'data-short-name',
      'data-name',
      'data-title',
    ]) {
      const value = el.getAttribute(attribute)
      if (value) result[attribute] = cut(value.replace(/\s+/g, ' ').trim(), 200)
    }
    return result
  }

  const ancestorSignature = (el: Element): string => {
    const composedParent = (element: Element): Element | null => {
      if (element.parentElement) return element.parentElement
      const root = element.getRootNode()
      return 'host' in root ? (root.host as Element) : null
    }
    let parent = composedParent(el)
    for (let depth = 0; parent && depth < 5; depth++, parent = composedParent(parent)) {
      for (const attribute of [
        'id',
        'aria-label',
        'data-testid',
        'data-test-id',
        'data-qa',
        'data-key',
      ]) {
        const marker = parent.getAttribute(attribute)
        if (marker) {
          return `${parent.tagName.toUpperCase()}:${attribute}=${cut(marker, 120)}`
        }
      }
    }
    return ''
  }

  const contextSignature = (el: Element): string => {
    const ownName = nameFor(el)
    let current: Element | null = el
    for (let depth = 0; depth < 4; depth++) {
      if (current.parentElement) current = current.parentElement
      else {
        const root = current.getRootNode()
        current = 'host' in root ? (root.host as Element) : null
      }
      if (!current || ['BODY', 'HTML'].includes(current.tagName.toUpperCase())) break
      const raw = ((current as HTMLElement).innerText || current.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
      const rowLike = current.matches(
        'li, tr, [role="row"], [role="listitem"], [role="treeitem"], [role="gridcell"]'
      )
      if (raw && raw !== ownName && (rowLike || raw.length <= 400)) {
        return `${current.tagName.toUpperCase()}:${cut(raw, 240)}`
      }
    }
    return ''
  }

  const registerElement = (el: Element, role: string, name: string): number => {
    const id = nextElementId++
    registry[id] = el
    locators[id] = {
      url: pageUrlFor(el),
      tag: el.tagName.toUpperCase(),
      role,
      name,
      attributes: locatorAttributes(el),
      ancestor: ancestorSignature(el),
      context: contextSignature(el),
    }
    refCount++
    window.__simAgentNextElementId = nextElementId
    return id
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
    if (refCount >= refCap || lines.length >= lineCap) {
      truncated = true
      return
    }
    let role = roleFor(el)
    const tag = String(el.tagName || '').toUpperCase()
    const name = nameFor(el)
    const id = registerElement(el, role, name)
    const parts: string[] = []
    if (isSecretField(el)) {
      role = 'password-field'
    } else if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      // Tag comparison so fields inside same-origin iframes report their value
      // like any other. Redaction above is realm-safe and runs first, so
      // widening this cannot expose a credential field.
      const value = (el as HTMLInputElement).value
      const inputType = tag === 'INPUT' ? (el as HTMLInputElement).type : ''
      if (inputType === 'file') {
        parts.push('upload-unsupported')
      } else if (inputType !== 'checkbox' && inputType !== 'radio') {
        if (value && isSensitiveValueField(el)) parts.push('value-withheld')
        else if (value) parts.push(`value=${quote(cut(String(value), 120))}`)
      }
    }
    if (tag === 'A') {
      const href = el.getAttribute('href')
      if (href) parts.push(`href=${quote(cut(href, 200))}`)
    }
    if ((el as HTMLInputElement).disabled === true) parts.push('disabled')
    if (el.getAttribute('aria-disabled') === 'true') parts.push('aria-disabled')
    if (el.getAttribute('aria-readonly') === 'true') parts.push('aria-readonly')
    if (el.getAttribute('aria-required') === 'true') parts.push('aria-required')
    if (tag === 'INPUT') {
      const input = el as HTMLInputElement
      if (input.type === 'checkbox' || input.type === 'radio') {
        parts.push(input.indeterminate ? 'mixed' : input.checked ? 'checked' : 'unchecked')
      }
      if (input.readOnly) parts.push('readonly')
      if (input.required) parts.push('required')
    } else if (tag === 'TEXTAREA') {
      const textarea = el as HTMLTextAreaElement
      if (textarea.readOnly) parts.push('readonly')
      if (textarea.required) parts.push('required')
    } else if (tag === 'SELECT' && (el as HTMLSelectElement).required) {
      parts.push('required')
    }
    for (const attribute of ['aria-checked', 'aria-expanded', 'aria-pressed', 'aria-selected']) {
      const value = el.getAttribute(attribute)
      if (value === 'true' || value === 'false' || value === 'mixed') {
        parts.push(`${attribute}=${value}`)
      }
    }
    const suffix = parts.length > 0 ? ` ${parts.join(' ')}` : ''
    const lineIndex = lines.length
    if (push(`${indent}- ${role} ${quote(name)} [ref=${id}]${suffix}`)) {
      refLineIndexes[id] = lineIndex
    }
  }

  const emitTextLeaf = (el: Element, indent: string, renderedLabel?: string): void => {
    if (refCount >= refCap || textRefCount >= textRefCap || lines.length >= lineCap) {
      truncated = true
      return
    }
    const text = cut(
      (renderedLabel || (el as HTMLElement).innerText || el.textContent || nameFor(el) || '')
        .replace(/\s+/g, ' ')
        .trim(),
      160
    )
    if (!text) return
    const id = registerElement(el, roleFor(el), text)
    textRefCount++
    const lineIndex = lines.length
    if (push(`${indent}- text ${quote(text)} [ref=${id}]`)) refLineIndexes[id] = lineIndex
  }

  const headingLevel = (el: Element): number | null => {
    const match = /^H([1-6])$/.exec(String(el.tagName || '').toUpperCase())
    if (match) return Number(match[1])
    if (el.getAttribute('role') === 'heading') {
      const level = Number(el.getAttribute('aria-level') || '2')
      return Number.isFinite(level) ? level : 2
    }
    return null
  }

  const landmarkLabel = (el: Element): string => {
    const rawRole = el.getAttribute('role')
    const role = rawRole ? cut(rawRole.replace(/[^a-zA-Z0-9_-]+/g, '-'), 40) : ''
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
    return label ? `${kind} ${quote(label)}` : kind
  }

  const pointerBoundary = (el: Element): boolean => {
    const view = el.ownerDocument.defaultView
    if (!view || view.getComputedStyle(el).cursor !== 'pointer') return false
    const root = el.getRootNode()
    const parent = el.parentElement ?? ('host' in root ? (root.host as Element) : null)
    return (
      !parent || parent.ownerDocument.defaultView?.getComputedStyle(parent).cursor !== 'pointer'
    )
  }

  const walk = (root: ParentNode, depth: number, suppressTextCoveredBy = ''): void => {
    if (refCount >= refCap || depth > depthCap) {
      truncated = true
      return
    }
    for (const el of Array.from(root.children)) {
      visitedNodes++
      if (refCount >= refCap || visitedNodes > nodeCap) {
        truncated = true
        return
      }
      const tag = String(el.tagName || '').toUpperCase()
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') continue

      const indent = '  '.repeat(depth)
      let childDepth = depth
      let emittedInteractive = false
      let interactiveName = ''
      const visible = isVisible(el)

      if (el.matches(landmarkSelector) && visible) {
        if (!push(`${indent}- ${landmarkLabel(el)}:`)) return
        childDepth = depth + 1
      } else {
        const level = headingLevel(el)
        if (level !== null && visible) {
          const text = cut(((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim(), 160)
          if (text) push(`${indent}- heading ${quote(text)} (h${level})`)
        } else if (visible && (el.matches(interactiveSelector) || pointerBoundary(el))) {
          emitInteractive(el, indent)
          emittedInteractive = true
          interactiveName = nameFor(el)
          // Interactive containers rarely nest other interactives; still
          // recurse so e.g. a clickable card exposes its inner links.
        } else if (visible) {
          const visibleElementChild = Array.from(el.children).some(isVisible)
          const leafLabel = visibleElementChild
            ? ''
            : (((el as HTMLElement).innerText || el.textContent || nameFor(el) || '') as string)
                .replace(/\s+/g, ' ')
                .trim()
          if (
            !visibleElementChild &&
            leafLabel &&
            (!suppressTextCoveredBy || !suppressTextCoveredBy.includes(leafLabel))
          ) {
            emitTextLeaf(el, indent, leafLabel)
          }
        }
      }

      const coveredText = emittedInteractive ? interactiveName : suppressTextCoveredBy

      if (tag === 'IFRAME' || tag === 'FRAME') {
        try {
          const innerDoc = (el as HTMLIFrameElement).contentDocument
          if (innerDoc?.body && isVisible(el)) {
            if (!push(`${indent}- iframe:`)) return
            walk(innerDoc.body, childDepth + 1, coveredText)
          }
        } catch {
          // Cross-origin iframe — not readable.
        }
        continue
      }

      const shadow = (el as HTMLElement).shadowRoot
      if (shadow) walk(shadow, childDepth, coveredText)
      walk(el, childDepth, coveredText)
    }
  }

  if (document.body) walk(document.body, 0)

  /**
   * React commonly replaces a control's DOM node while preserving its
   * semantics. Recover only when the old page origin and a strong semantic
   * fingerprint still identify one candidate; a weak or ambiguous match is a
   * real stale ref, never permission to click something nearby.
   */
  window.__simAgentResolveElement = (id: number) => {
    const locator = locators[id]
    if (!locator) {
      window.__simAgentStaleReason = `id ${id} is not in the current snapshot's registry`
      return null
    }

    // Origin, not full URL: a live SPA rewrites its path with pushState
    // between snapshot and act (Slack does so continuously), while the
    // element the model chose is often still the same mounted node. The
    // origin still pins the document/frame; the role/name/attribute and
    // ancestor/context signatures below pin the element itself.
    const pageOriginOf = (url: string): string => {
      try {
        return new URL(url).origin
      } catch {
        return url
      }
    }

    const stableAttributes = [
      'id',
      'href',
      'data-testid',
      'data-test-id',
      'data-key',
      'data-emoji-name',
      'data-short-name',
    ]
    const connectedIdentityAttributes = [
      ...stableAttributes,
      'data-qa',
      'data-index',
      'data-name',
      'data-title',
    ]
    const identityMatches = (candidate: Element, connected = false): boolean => {
      if (
        candidate.tagName.toUpperCase() !== locator.tag ||
        pageOriginOf(pageUrlFor(candidate)) !== pageOriginOf(locator.url) ||
        roleFor(candidate) !== locator.role
      ) {
        return false
      }
      if (nameFor(candidate) !== locator.name) return false
      const candidateAttributes = locatorAttributes(candidate)
      const attributes = connected ? connectedIdentityAttributes : stableAttributes
      const genericName =
        /^(?:more(?: actions?)?|open|menu|options?|edit|delete|view|button|link)$/i.test(
          locator.name
        )
      const stableAttributePresent = attributes.some((attribute) =>
        Boolean(locator.attributes[attribute])
      )
      const hasIdentitySignal =
        Boolean(locator.name) ||
        Boolean(locator.ancestor) ||
        Boolean(locator.context) ||
        stableAttributePresent
      if (!hasIdentitySignal) return false
      if (locator.ancestor && ancestorSignature(candidate) !== locator.ancestor) return false
      // Full row text is useful to disambiguate a detached replacement and a
      // generic recycled action button. It is intentionally not a hard check
      // for every connected control: timestamps and unread badges can update
      // without changing the control itself, which would recreate Slack's
      // chronic one-action-old ref behavior.
      if (
        locator.context &&
        (!connected || genericName) &&
        contextSignature(candidate) !== locator.context
      ) {
        return false
      }
      if (
        connected &&
        genericName &&
        !locator.ancestor &&
        !locator.context &&
        !stableAttributePresent
      ) {
        return false
      }
      return attributes.every(
        (attribute) =>
          !locator.attributes[attribute] ||
          candidateAttributes[attribute] === locator.attributes[attribute]
      )
    }

    // The snapshot-time visibility WeakMap is intentionally not used here.
    // React apps often keep the old combobox/control connected but collapse it
    // to zero size while mounting a replacement. Re-check live so a parked
    // node can fall through to the same strict, unique recovery used for a
    // detached node.
    const isCurrentlyVisible = (candidate: Element): boolean => {
      const rect = candidate.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return false
      for (let current: Element | null = candidate; current; ) {
        const currentView: Window | null = current.ownerDocument.defaultView
        const style = currentView?.getComputedStyle(current)
        const opacity = Number.parseFloat(style?.opacity || '1')
        if (
          !style ||
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.contentVisibility === 'hidden' ||
          (Number.isFinite(opacity) && opacity <= 0.01) ||
          current.hasAttribute('hidden') ||
          current.getAttribute('aria-hidden') === 'true'
        ) {
          return false
        }
        if (current.parentElement) current = current.parentElement
        else {
          const root = current.getRootNode()
          current = 'host' in root ? (root.host as Element) : null
        }
      }
      return true
    }

    const current = registry[id]
    if (current?.isConnected) {
      if (!identityMatches(current, true)) {
        window.__simAgentStaleReason = `the node is still mounted but its identity drifted (now <${String(current.tagName || '').toLowerCase()}> role=${roleFor(current) || 'none'} name="${nameFor(current).slice(0, 60)}")`
        return null
      }
      if (isCurrentlyVisible(current)) {
        window.__simAgentStaleReason = undefined
        return { element: current, recovered: false }
      }
    }

    // Past this point the original node is gone or hidden, so anything returned
    // is a DIFFERENT node adopted by structural resemblance. Identity matching
    // compares origins only — deliberately, so a pushState between snapshot and
    // act does not kill every ref — but that same leniency let a ref to "More
    // actions" on a row in one view rebind to the identical control in another
    // view the app had since navigated to, and act on the wrong thing with no
    // signal beyond `recovered: true`.
    //
    // A same-document path change means the view was swapped, so resemblance is
    // no longer evidence of sameness. Refuse to adopt and report the ref stale:
    // the caller re-snapshots, which is cheap and always correct. Revalidating
    // the still-connected node above stays lenient — it is literally the node
    // the model chose.
    const pathOf = (url: string): string => {
      try {
        const parsed = new URL(url)
        return `${parsed.origin}${parsed.pathname}`
      } catch {
        return url
      }
    }
    if (pathOf(window.location.href) !== pathOf(locator.url)) {
      window.__simAgentStaleReason = `the view changed since the snapshot (${pathOf(locator.url)} -> ${pathOf(window.location.href)}), so a lookalike must not be adopted`
      return null
    }

    const reachable: Element[] = []
    let candidateCount = 0
    const collect = (root: ParentNode, depth = 0): void => {
      if (depth > depthCap || candidateCount >= nodeCap) return
      for (const element of Array.from(root.children)) {
        candidateCount++
        if (candidateCount > nodeCap) return
        reachable.push(element)
        const shadow = (element as HTMLElement).shadowRoot
        if (shadow) collect(shadow, depth + 1)
        const tag = String(element.tagName || '').toUpperCase()
        if (tag === 'IFRAME' || tag === 'FRAME') {
          try {
            const inner = (element as HTMLIFrameElement).contentDocument
            if (inner?.body) collect(inner.body, depth + 1)
          } catch {
            // Cross-origin frame — not searchable.
          }
        }
        collect(element, depth + 1)
      }
    }
    if (document.body) collect(document.body)

    const scored = reachable
      .filter((candidate) => identityMatches(candidate) && isCurrentlyVisible(candidate))
      .map((candidate) => {
        const candidateAttributes = locatorAttributes(candidate)
        const logicalAttributeMatch = [
          'href',
          'data-key',
          'data-emoji-name',
          'data-short-name',
        ].some(
          (attribute) =>
            Boolean(locator.attributes[attribute]) &&
            candidateAttributes[attribute] === locator.attributes[attribute]
        )
        const ancestorMatch = Boolean(
          locator.ancestor && ancestorSignature(candidate) === locator.ancestor
        )
        const textContextMatch = Boolean(
          locator.context && contextSignature(candidate) === locator.context
        )
        const genericAttributeMatch = ['id', 'data-testid', 'data-test-id'].some(
          (attribute) =>
            Boolean(locator.attributes[attribute]) &&
            candidateAttributes[attribute] === locator.attributes[attribute]
        )
        // Exact role+label alone is unsafe for generic controls such as Close:
        // after one panel disappears, another panel's Close can be the sole
        // candidate. Require a stable key or the same structural context.
        if (locator.ancestor && !ancestorMatch) return { candidate, score: -1 }
        if (locator.context && !textContextMatch) return { candidate, score: -1 }
        if (
          !logicalAttributeMatch &&
          !genericAttributeMatch &&
          !ancestorMatch &&
          !textContextMatch
        ) {
          return { candidate, score: -1 }
        }
        let score = 65
        for (const [attribute, expected] of Object.entries(locator.attributes)) {
          if (candidateAttributes[attribute] !== expected) continue
          if (attribute === 'id') score += 100
          else if (attribute.startsWith('data-')) score += 45
          else if (attribute === 'name' || attribute === 'href' || attribute === 'aria-label') {
            score += 25
          } else score += 8
        }
        if (ancestorMatch) score += 20
        if (textContextMatch) score += 20
        return { candidate, score }
      })
      .filter((entry) => entry.score >= 45)
      .sort((a, b) => b.score - a.score)

    if (scored.length === 0) {
      window.__simAgentStaleReason =
        'the original node left the DOM and no confident replacement matched'
      return null
    }
    const bestScore = scored[0].score
    const best = scored.filter((entry) => entry.score === bestScore)
    const chosen = best.length === 1 ? best[0] : undefined
    if (!chosen) {
      window.__simAgentStaleReason = `the original node left the DOM and ${best.length} equally-plausible replacements tied`
      return null
    }
    registry[id] = chosen.candidate
    window.__simAgentStaleReason = undefined
    return { element: chosen.candidate, recovered: true }
  }

  return {
    url: cut(window.location.href, 4096),
    title: cut(document.title, 500),
    outline: lines.join('\n'),
    truncated,
    scrollY: Math.round(window.scrollY),
    pageHeight: Math.round(document.documentElement.scrollHeight),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    refIds: Object.keys(locators).map(Number),
    refLineIndexes,
    nextElementId,
  }
}

export function clickElement(
  id: number,
  dispatchSynthetic = true,
  focusForKeyboard = false,
  allowDisabled = false
): unknown {
  const isSecretField = (node: Element | null): boolean => {
    if (!node || String(node.tagName || '').toUpperCase() !== 'INPUT') return false
    if (String((node as HTMLInputElement).type || '').toLowerCase() === 'password') return true
    const hint = String(node.getAttribute('autocomplete') || '').toLowerCase()
    return hint
      .split(/\s+/)
      .some((token) => token === 'current-password' || token === 'new-password')
  }

  const resolver = window.__simAgentResolveElement
  const resolved = resolver?.(id)
  const el = resolver ? resolved?.element : (window.__simAgentElements || [])[id]
  if (!el || !el.isConnected) return { error: 'stale', reason: window.__simAgentStaleReason }
  const isDisabled = (node: Element | null): boolean =>
    Boolean(
      node &&
        ((node as Element & { disabled?: boolean }).disabled === true ||
          node.getAttribute('aria-disabled') === 'true')
    )
  // Clicking focuses, and a focused credential field is the one state in
  // which subsequent keystrokes would land in a password. Refusing the click
  // keeps that state unreachable rather than relying on every later keyboard
  // path to re-check.
  if (isSecretField(el)) return { error: 'password' }
  if (!allowDisabled && isDisabled(el)) return { error: 'disabled' }
  if (
    String(el.tagName || '').toUpperCase() === 'INPUT' &&
    String((el as HTMLInputElement).type || '').toLowerCase() === 'file'
  ) {
    return { error: 'file-input' }
  }
  if (String(el.tagName || '').toUpperCase() === 'LABEL') {
    const control = (el as HTMLLabelElement).control
    if (isSecretField(control)) return { error: 'password' }
    if (!allowDisabled && isDisabled(control)) return { error: 'disabled' }
    if (
      control &&
      String(control.tagName || '').toUpperCase() === 'INPUT' &&
      String((control as HTMLInputElement).type || '').toLowerCase() === 'file'
    ) {
      return { error: 'file-input' }
    }
  }
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })

  const view = el.ownerDocument.defaultView
  if (!view) return { error: 'stale', reason: window.__simAgentStaleReason }
  for (let current: Element | null = el; current; ) {
    const currentView: Window | null = current.ownerDocument.defaultView
    const style = currentView?.getComputedStyle(current)
    const opacity = Number.parseFloat(style?.opacity || '1')
    if (
      !style ||
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.contentVisibility === 'hidden' ||
      (Number.isFinite(opacity) && opacity <= 0.01) ||
      current.hasAttribute('hidden') ||
      current.getAttribute('aria-hidden') === 'true'
    ) {
      return { error: 'not-visible' }
    }
    if (current.parentElement) current = current.parentElement
    else {
      const root = current.getRootNode()
      if ('host' in root) current = root.host as Element
      else {
        const frame: Element | null = current.ownerDocument.defaultView?.frameElement ?? null
        current = frame ? (frame as Element) : null
      }
    }
  }
  const rawRects = Array.from(el.getClientRects())
  if (rawRects.length === 0) rawRects.push(el.getBoundingClientRect())
  const rects = rawRects
    .map((rect) => ({
      left: Math.max(0, rect.left),
      top: Math.max(0, rect.top),
      right: Math.min(view.innerWidth, rect.right),
      bottom: Math.min(view.innerHeight, rect.bottom),
    }))
    .filter(
      (rect) =>
        Number.isFinite(rect.left) &&
        Number.isFinite(rect.top) &&
        Number.isFinite(rect.right) &&
        Number.isFinite(rect.bottom) &&
        rect.right - rect.left > 1 &&
        rect.bottom - rect.top > 1
    )
  if (rects.length === 0) return { error: 'not-visible' }

  const composedParent = (node: Element): Element | null => {
    if (node.parentElement) return node.parentElement
    const root = node.getRootNode()
    return 'host' in root ? (root.host as Element) : null
  }
  const isIndependentInteractive = (node: Element): boolean => {
    const role = node.getAttribute('role') || ''
    const tag = String(node.tagName || '').toUpperCase()
    return (
      tag === 'A' ||
      tag === 'BUTTON' ||
      tag === 'INPUT' ||
      tag === 'SELECT' ||
      tag === 'TEXTAREA' ||
      tag === 'SUMMARY' ||
      node.hasAttribute('onclick') ||
      (node.hasAttribute('tabindex') && Number(node.getAttribute('tabindex')) >= 0) ||
      (node as HTMLElement).isContentEditable ||
      [
        'button',
        'link',
        'textbox',
        'searchbox',
        'checkbox',
        'radio',
        'combobox',
        'menuitem',
        'tab',
        'switch',
        'option',
      ].includes(role)
    )
  }
  const hitBelongsToTarget = (hit: Element | null): boolean => {
    if (
      hit?.contains(el) &&
      el.ownerDocument.defaultView?.getComputedStyle(el).pointerEvents === 'none'
    ) {
      return true
    }
    for (let current = hit; current; current = composedParent(current)) {
      if (current === el) return true
      // A card/row may contain its own link or button. Clicking that nested
      // control is a different action even though it is technically a
      // descendant of the requested ref.
      if (isIndependentInteractive(current)) return false
    }
    return false
  }
  const elementAt = (x: number, y: number): Element | null => {
    const root = el.getRootNode() as ParentNode & {
      elementFromPoint?: (clientX: number, clientY: number) => Element | null
    }
    if (typeof root.elementFromPoint === 'function') return root.elementFromPoint(x, y)
    if (typeof el.ownerDocument.elementFromPoint === 'function') {
      return el.ownerDocument.elementFromPoint(x, y)
    }
    // DOM-only test environments do not implement hit testing; real Chromium
    // always takes one of the branches above.
    return el
  }

  let clientX = 0
  let clientY = 0
  let blocker: Element | null = null
  const blockedHits: Array<Element | null> = []
  let foundPoint = false
  const blockerLabel = (element: Element | null): string =>
    (
      element?.getAttribute('aria-label') ||
      (element as HTMLElement | null)?.innerText ||
      element?.textContent ||
      element?.tagName ||
      'another element'
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120)
      .replace(/[\uD800-\uDBFF]$/, '')
  const fractions = [0.5, 0.2, 0.8]
  for (const rect of rects) {
    for (const xFraction of fractions) {
      for (const yFraction of fractions) {
        const x = rect.left + (rect.right - rect.left) * xFraction
        const y = rect.top + (rect.bottom - rect.top) * yFraction
        const hit = elementAt(x, y)
        if (hitBelongsToTarget(hit)) {
          clientX = x
          clientY = y
          foundPoint = true
          break
        }
        blocker ??= hit
        blockedHits.push(hit)
      }
      if (foundPoint) break
    }
    if (foundPoint) break
  }
  if (!foundPoint) {
    const suggestionsCoverFocusedEditable = (): boolean => {
      const candidates: HTMLElement[] = []
      const addCandidate = (candidate: Element): void => {
        const candidateTag = String(candidate.tagName || '').toUpperCase()
        const inputType =
          candidateTag === 'INPUT'
            ? String((candidate as HTMLInputElement).type || 'text').toLowerCase()
            : ''
        if (
          candidateTag === 'TEXTAREA' ||
          (candidateTag === 'INPUT' &&
            ['text', 'search', 'email', 'url', 'tel', 'number'].includes(inputType)) ||
          (candidate as HTMLElement).isContentEditable
        ) {
          candidates.push(candidate as HTMLElement)
        }
      }
      addCandidate(el)
      for (const candidate of Array.from(
        el.querySelectorAll<HTMLElement>(
          'input, textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [role="textbox"]'
        )
      )) {
        addCandidate(candidate)
      }
      const editables = Array.from(new Set(candidates))
      if (editables.length !== 1 || !blocker || blockedHits.length === 0) return false
      const editable = editables[0]
      if (editable.ownerDocument.activeElement !== editable) return false
      let owner: Element | null = editable
      for (let depth = 0; owner && depth < 10; depth++) {
        if (owner.getAttribute('role') === 'combobox') break
        owner = composedParent(owner)
      }
      if (!owner || owner.getAttribute('aria-expanded') !== 'true') return false
      const ids = new Set<string>()
      for (let current: Element | null = editable; current; current = composedParent(current)) {
        for (const attribute of ['aria-controls', 'aria-owns']) {
          for (const token of (current.getAttribute(attribute) || '').trim().split(/\s+/)) {
            if (token) ids.add(token)
          }
        }
        if (current === owner) break
      }
      const scopes = Array.from(
        new Set<ParentNode>([owner.getRootNode() as ParentNode, editable.ownerDocument])
      )
      const controlledPopups: Element[] = []
      for (const idRef of ids) {
        const matches = new Set<Element>()
        for (const scope of scopes) {
          let visited = 0
          for (const candidate of Array.from(scope.querySelectorAll('[id]'))) {
            if (++visited > 12_000) break
            if (candidate.id === idRef) matches.add(candidate)
          }
        }
        if (matches.size !== 1) continue
        const popup = Array.from(matches)[0]
        if (
          ['listbox', 'tree', 'grid'].includes(popup.getAttribute('role') || '') &&
          popup.getAttribute('aria-modal') !== 'true'
        ) {
          controlledPopups.push(popup)
        }
      }
      if (controlledPopups.length === 0) return false
      const coveringPopups = new Set<Element>()
      for (const hit of blockedHits) {
        if (!hit) return false
        const popup = controlledPopups.find((candidate) => candidate.contains(hit))
        if (!popup) return false
        coveringPopups.add(popup)
      }
      return coveringPopups.size === 1
    }
    if (suggestionsCoverFocusedEditable()) {
      return { error: 'suggestions-open', blocker: blockerLabel(blocker) }
    }
    // A hit INSIDE the requested element is not an overlay — it is the ref
    // wrapping its own control (a row containing a button, a card containing a
    // link). hitBelongsToTarget rejects both cases identically, so this was
    // reported as "covered by X, close or move the overlay", advice that cannot
    // be followed because there is nothing to close. Name it for what it is so
    // the agent retargets instead of hunting a phantom overlay.
    let nested = false
    for (let current = blocker; current; current = composedParent(current)) {
      if (current === el) {
        nested = true
        break
      }
    }
    if (nested) {
      return { error: 'nested-control', blocker: blockerLabel(blocker) }
    }
    return { error: 'obstructed', blocker: blockerLabel(blocker) }
  }

  let pageX = clientX
  let pageY = clientY
  let ownerView: Window | null = el.ownerDocument.defaultView
  let frameDepth = 0
  while (ownerView && ownerView !== window) {
    const frame: Element | null = ownerView.frameElement
    if (!frame) break
    const frameRect = frame.getBoundingClientRect()
    const frameElement = frame as HTMLElement
    const scaleX = frameElement.offsetWidth > 0 ? frameRect.width / frameElement.offsetWidth : 1
    const scaleY = frameElement.offsetHeight > 0 ? frameRect.height / frameElement.offsetHeight : 1
    pageX = frameRect.left + (pageX + frameElement.clientLeft) * scaleX
    pageY = frameRect.top + (pageY + frameElement.clientTop) * scaleY
    const parentRoot = frame.getRootNode() as ParentNode & {
      elementFromPoint?: (clientX: number, clientY: number) => Element | null
    }
    const parentDocument: Document = frame.ownerDocument
    const parentElementAt: ((clientX: number, clientY: number) => Element | null) | null =
      typeof parentRoot.elementFromPoint === 'function'
        ? parentRoot.elementFromPoint.bind(parentRoot)
        : typeof parentDocument.elementFromPoint === 'function'
          ? parentDocument.elementFromPoint.bind(parentDocument)
          : null
    if (parentElementAt) {
      const parentHit: Element | null = parentElementAt(pageX, pageY)
      if (parentHit !== frame) {
        return { error: 'obstructed', blocker: blockerLabel(parentHit) }
      }
    }
    ownerView = frame.ownerDocument.defaultView
    frameDepth++
  }
  const opts = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX,
    clientY,
    button: 0,
  }
  // Duck-typed rather than `instanceof HTMLElement`: an element reached
  // through a same-origin iframe belongs to that frame's realm, so the check
  // is false there and the click would skip focus entirely.
  const html = el as HTMLElement
  const role = el.getAttribute('role') || ''
  const tag = String(el.tagName || '').toUpperCase()
  const inputType =
    tag === 'INPUT' ? String((el as HTMLInputElement).type || 'text').toLowerCase() : ''
  const activationKey =
    tag === 'A' ||
    tag === 'BUTTON' ||
    tag === 'SUMMARY' ||
    role === 'button' ||
    role === 'link' ||
    role === 'menuitem' ||
    role === 'tab'
      ? 'Enter'
      : (tag === 'INPUT' &&
            ['button', 'submit', 'reset', 'image', 'checkbox', 'radio'].includes(inputType)) ||
          role === 'checkbox' ||
          role === 'radio' ||
          role === 'switch' ||
          role === 'option'
        ? 'Space'
        : undefined
  const editable =
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    html.isContentEditable ||
    role === 'textbox' ||
    role === 'searchbox' ||
    role === 'combobox'
  if (focusForKeyboard && typeof html.focus === 'function') html.focus()
  if (dispatchSynthetic) {
    el.dispatchEvent(new PointerEvent('pointerdown', opts))
    el.dispatchEvent(new MouseEvent('mousedown', opts))
    if (typeof html.focus === 'function') html.focus()
    el.dispatchEvent(new PointerEvent('pointerup', opts))
    el.dispatchEvent(new MouseEvent('mouseup', opts))
    if (typeof html.click === 'function') html.click()
    else el.dispatchEvent(new MouseEvent('click', opts))
  }
  const label = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  // Drop a trailing lone high surrogate the slice may have created.
  return {
    dispatched: dispatchSynthetic,
    element: label.replace(/[\uD800-\uDBFF]$/, ''),
    x: pageX,
    y: pageY,
    clientX,
    clientY,
    activationKey,
    editable,
    frameDepth,
    focusSucceeded: focusForKeyboard && el.ownerDocument.activeElement === el,
    refRecovered: resolved?.recovered === true,
  }
}

/**
 * Prepares an element for NATIVE typing (driver-side CDP `Input.insertText`):
 * focuses it and selects its current content so the inserted text REPLACES
 * what's there — including inside code editors (CodeMirror/Monaco), whose
 * models sync from the DOM selection / native input pipeline.
 */
export function focusElementForTyping(id: number, moveFocus = true): unknown {
  const isSecretField = (node: Element | null): boolean => {
    if (!node || String(node.tagName || '').toUpperCase() !== 'INPUT') return false
    if (String((node as HTMLInputElement).type || '').toLowerCase() === 'password') return true
    const hint = String(node.getAttribute('autocomplete') || '').toLowerCase()
    return hint
      .split(/\s+/)
      .some((token) => token === 'current-password' || token === 'new-password')
  }

  const resolver = window.__simAgentResolveElement
  const resolved = resolver?.(id)
  const el = resolver ? resolved?.element : (window.__simAgentElements || [])[id]
  if (!el || !el.isConnected) return { error: 'stale', reason: window.__simAgentStaleReason }

  const isWritableTextField = (
    field: HTMLInputElement | HTMLTextAreaElement
  ): 'writable' | 'disabled' | 'readonly' | 'not-editable' => {
    if (field.disabled || field.getAttribute('aria-disabled') === 'true') return 'disabled'
    if (field.readOnly || field.getAttribute('aria-readonly') === 'true') return 'readonly'
    if (String(field.tagName || '').toUpperCase() === 'TEXTAREA') return 'writable'
    const type = String((field as HTMLInputElement).type || 'text').toLowerCase()
    return ['text', 'search', 'email', 'url', 'tel', 'number'].includes(type)
      ? 'writable'
      : 'not-editable'
  }

  const tagFor = (node: Element): string => String(node.tagName || '').toUpperCase()
  const potentialEditables: HTMLElement[] = []
  const addEditable = (node: Element): void => {
    const tag = tagFor(node)
    const inputType =
      tag === 'INPUT' ? String((node as HTMLInputElement).type || 'text').toLowerCase() : ''
    if (
      tag === 'TEXTAREA' ||
      (tag === 'INPUT' &&
        ['text', 'search', 'email', 'url', 'tel', 'number', 'password'].includes(inputType)) ||
      (node as HTMLElement).isContentEditable ||
      // An ARIA-only textbox. The snapshot already advertises these as
      // `[textbox]` with a ref, and browser_insert_text accepts them, so
      // refusing here meant one tool rejecting exactly what the outline told
      // the model to type into and what its sibling would have accepted.
      node.getAttribute('role') === 'textbox'
    ) {
      potentialEditables.push(node as HTMLElement)
    }
  }
  addEditable(el)
  for (const candidate of Array.from(
    el.querySelectorAll<HTMLElement>(
      'input, textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [role="textbox"]'
    )
  )) {
    addEditable(candidate)
  }
  const editables = Array.from(new Set(potentialEditables))
  if (editables.length === 0) {
    // Describe the element instead of only refusing it. Without this the agent
    // cannot tell "wrong ref" from "this tool cannot type here" and retries
    // variations of the same failing call.
    return {
      error: 'not-editable',
      elementTag: String(el.tagName || '').toLowerCase(),
      ...(el.getAttribute('role') ? { elementRole: el.getAttribute('role') } : {}),
    }
  }
  if (editables.length > 1) {
    // The candidate list is right here; discarding it left the agent unable to
    // pick a narrower target, which is the only recovery this error allows.
    return {
      error: 'ambiguous-editable',
      candidates: editables.slice(0, 5).map((field) => {
        const fieldTag = String(field.tagName || '').toLowerCase()
        const label = field.getAttribute('aria-label') || field.getAttribute('placeholder') || ''
        return label ? `${fieldTag} "${label}"` : fieldTag
      }),
    }
  }
  const editable = editables[0]
  const editableTag = tagFor(editable)

  if (isSecretField(editable)) return { error: 'password' }
  if (editableTag === 'INPUT' || editableTag === 'TEXTAREA') {
    const writable = isWritableTextField(editable as HTMLInputElement | HTMLTextAreaElement)
    if (writable !== 'writable') return { error: writable }
  } else {
    if (editable.getAttribute('aria-disabled') === 'true') return { error: 'disabled' }
    if (editable.getAttribute('aria-readonly') === 'true') return { error: 'readonly' }
  }

  editable.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })

  const composedParent = (node: Element): Element | null => {
    if (node.parentElement) return node.parentElement
    const root = node.getRootNode()
    return 'host' in root ? (root.host as Element) : null
  }
  const rawRects = Array.from(editable.getClientRects())
  if (rawRects.length === 0) rawRects.push(editable.getBoundingClientRect())
  const view = editable.ownerDocument.defaultView
  if (!view) return { error: 'stale', reason: window.__simAgentStaleReason }
  const rects = rawRects
    .map((rect) => ({
      left: Math.max(0, rect.left),
      top: Math.max(0, rect.top),
      right: Math.min(view.innerWidth, rect.right),
      bottom: Math.min(view.innerHeight, rect.bottom),
    }))
    .filter(
      (rect) =>
        Number.isFinite(rect.left) &&
        Number.isFinite(rect.top) &&
        Number.isFinite(rect.right) &&
        Number.isFinite(rect.bottom) &&
        rect.right - rect.left > 1 &&
        rect.bottom - rect.top > 1
    )
  if (rects.length === 0) return { error: 'not-visible' }
  for (let current: Element | null = editable; current; current = composedParent(current)) {
    const currentView: Window | null = current.ownerDocument.defaultView
    const style = currentView?.getComputedStyle(current)
    const opacity = Number.parseFloat(style?.opacity || '1')
    if (
      !style ||
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.contentVisibility === 'hidden' ||
      (Number.isFinite(opacity) && opacity <= 0.01) ||
      current.hasAttribute('hidden') ||
      current.getAttribute('aria-hidden') === 'true'
    ) {
      return { error: 'not-visible' }
    }
  }

  if (moveFocus) {
    editable.focus()
    if (editableTag === 'INPUT' || editableTag === 'TEXTAREA') {
      try {
        ;(editable as HTMLInputElement | HTMLTextAreaElement).select()
      } catch {
        // Trusted Mod+A in the driver still covers field types that reject select().
      }
    } else {
      const selection = editable.ownerDocument.defaultView?.getSelection()
      if (selection) {
        const range = editable.ownerDocument.createRange()
        range.selectNodeContents(editable)
        selection.removeAllRanges()
        selection.addRange(range)
      }
    }
  }

  const deepestActiveElement = (): HTMLElement | null => {
    let active = editable.ownerDocument.activeElement as HTMLElement | null
    for (let depth = 0; active && depth < 10; depth++) {
      if (active.shadowRoot?.activeElement) {
        active = active.shadowRoot.activeElement as HTMLElement
        continue
      }
      const activeTag = tagFor(active)
      if (activeTag === 'IFRAME' || activeTag === 'FRAME') {
        try {
          const inner = (active as HTMLIFrameElement).contentDocument
          if (inner?.activeElement && inner.activeElement !== inner.body) {
            active = inner.activeElement as HTMLElement
            continue
          }
        } catch {
          return active
        }
      }
      break
    }
    return active
  }
  const active = deepestActiveElement()
  if (isSecretField(active)) return { error: 'password' }
  if (!active || (active !== editable && !editable.contains(active))) return { error: 'different' }

  const root = editable.getRootNode() as ParentNode & {
    elementFromPoint?: (x: number, y: number) => Element | null
  }
  const elementAt =
    typeof root.elementFromPoint === 'function'
      ? root.elementFromPoint.bind(root)
      : typeof editable.ownerDocument.elementFromPoint === 'function'
        ? editable.ownerDocument.elementFromPoint.bind(editable.ownerDocument)
        : null

  let comboboxOwner: Element | null = editable
  for (let depth = 0; comboboxOwner && depth < 10; depth++) {
    if (comboboxOwner.getAttribute('role') === 'combobox') break
    comboboxOwner = composedParent(comboboxOwner)
  }
  const controlledPopups: Element[] = []
  if (comboboxOwner?.getAttribute('aria-expanded') === 'true') {
    const idRefs = new Set<string>()
    for (let current: Element | null = editable; current; current = composedParent(current)) {
      for (const attribute of ['aria-controls', 'aria-owns']) {
        for (const token of (current.getAttribute(attribute) || '').trim().split(/\s+/)) {
          if (token) idRefs.add(token)
        }
      }
      if (current === comboboxOwner) break
    }
    const scopes = Array.from(
      new Set<ParentNode>([comboboxOwner.getRootNode() as ParentNode, editable.ownerDocument])
    )
    for (const idRef of idRefs) {
      const matches = new Set<Element>()
      for (const scope of scopes) {
        let visited = 0
        for (const candidate of Array.from(scope.querySelectorAll('[id]'))) {
          if (++visited > 12_000) break
          if (candidate.id === idRef) matches.add(candidate)
        }
      }
      if (matches.size !== 1) continue
      const popup = Array.from(matches)[0]
      if (
        ['listbox', 'tree', 'grid'].includes(popup.getAttribute('role') || '') &&
        popup.getAttribute('aria-modal') !== 'true'
      ) {
        controlledPopups.push(popup)
      }
    }
  }

  const blockerLabel = (element: Element | null): string =>
    (
      element?.getAttribute('aria-label') ||
      (element as HTMLElement | null)?.innerText ||
      element?.textContent ||
      element?.tagName ||
      'another element'
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120)
      .replace(/[\uD800-\uDBFF]$/, '')
  const fractions = [0.5, 0.2, 0.8]
  let chosenPoint: { x: number; y: number } | null = null
  let firstBlocker: Element | null = null
  const blockedPoints: Array<{ x: number; y: number; hit: Element | null }> = []
  for (const rect of rects) {
    for (const xFraction of fractions) {
      for (const yFraction of fractions) {
        const x = rect.left + (rect.right - rect.left) * xFraction
        const y = rect.top + (rect.bottom - rect.top) * yFraction
        const hit = elementAt ? elementAt(x, y) : editable
        if (hit && (hit === editable || editable.contains(hit))) {
          chosenPoint = { x, y }
          break
        }
        firstBlocker ??= hit
        blockedPoints.push({ x, y, hit })
      }
      if (chosenPoint) break
    }
    if (chosenPoint) break
  }

  let coveredByRelatedPopup = false
  if (!chosenPoint && blockedPoints.length > 0) {
    const coveringPopups = new Set<Element>()
    let allRelated = controlledPopups.length > 0
    for (const point of blockedPoints) {
      const popup = point.hit
        ? controlledPopups.find((candidate) => candidate.contains(point.hit))
        : undefined
      if (!popup) {
        allRelated = false
        break
      }
      coveringPopups.add(popup)
    }
    if (allRelated && coveringPopups.size === 1) {
      chosenPoint = { x: blockedPoints[0].x, y: blockedPoints[0].y }
      coveredByRelatedPopup = true
    }
  }
  if (!chosenPoint) {
    return { error: 'obstructed', blocker: blockerLabel(firstBlocker) }
  }

  return {
    focused: true,
    kind:
      editableTag === 'INPUT'
        ? 'input'
        : editableTag === 'TEXTAREA'
          ? 'textarea'
          : 'contenteditable',
    x: chosenPoint.x,
    y: chosenPoint.y,
    coveredByRelatedPopup,
    refRecovered: resolved?.recovered === true,
  }
}

/**
 * Reads back the focused element's state after a native key/type action so
 * the driver can report what actually happened instead of assuming success.
 */
export function readActiveElementState(): unknown {
  const isSecretField = (node: Element | null): boolean => {
    if (!node || String(node.tagName || '').toUpperCase() !== 'INPUT') return false
    if (String((node as HTMLInputElement).type || '').toLowerCase() === 'password') return true
    const hint = String(node.getAttribute('autocomplete') || '').toLowerCase()
    return hint
      .split(/\s+/)
      .some((token) => token === 'current-password' || token === 'new-password')
  }

  /** Sensitive-but-fillable fields; see collectSnapshot's copy for why. */
  const isSensitiveValueField = (node: Element | null): boolean => {
    if (!node || String(node.tagName || '').toUpperCase() !== 'INPUT') return false
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
export function activeElementSecrecy(elementId?: number): string {
  const isSecretField = (node: Element | null): boolean => {
    if (!node || String(node.tagName || '').toUpperCase() !== 'INPUT') return false
    if (String((node as HTMLInputElement).type || '').toLowerCase() === 'password') return true
    const hint = String(node.getAttribute('autocomplete') || '').toLowerCase()
    return hint
      .split(/\s+/)
      .some((token) => token === 'current-password' || token === 'new-password')
  }

  const resolver = window.__simAgentResolveElement
  const resolved = typeof elementId === 'number' ? resolver?.(elementId) : undefined
  if (typeof elementId === 'number' && (!resolver || !resolved?.element?.isConnected))
    return 'stale'

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
  if (isSecretField(active)) return 'secret'
  if (typeof elementId === 'number') {
    const expected = resolved?.element ?? null
    const ownsVisibleSurface = (focused: HTMLElement): boolean => {
      const rect = focused.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return false
      const root = focused.getRootNode() as ParentNode & {
        elementFromPoint?: (x: number, y: number) => Element | null
      }
      const elementAt =
        typeof root.elementFromPoint === 'function'
          ? root.elementFromPoint.bind(root)
          : typeof focused.ownerDocument.elementFromPoint === 'function'
            ? focused.ownerDocument.elementFromPoint.bind(focused.ownerDocument)
            : null
      if (!elementAt) return true
      const hit = elementAt(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return Boolean(hit && (hit === focused || focused.contains(hit)))
    }
    let current: Element | null = active
    while (current) {
      if (current === expected) {
        return active && ownsVisibleSurface(active) ? 'safe' : 'different'
      }
      if (current.parentElement) current = current.parentElement
      else {
        const root = current.getRootNode()
        current = 'host' in root ? (root.host as Element) : null
      }
    }
    return 'different'
  }
  return 'safe'
}

export function typeIntoElement(id: number, text: string, submit: boolean): unknown {
  const isSecretField = (node: Element | null): boolean => {
    if (!node || String(node.tagName || '').toUpperCase() !== 'INPUT') return false
    if (String((node as HTMLInputElement).type || '').toLowerCase() === 'password') return true
    const hint = String(node.getAttribute('autocomplete') || '').toLowerCase()
    return hint
      .split(/\s+/)
      .some((token) => token === 'current-password' || token === 'new-password')
  }

  const resolver = window.__simAgentResolveElement
  const resolved = resolver?.(id)
  const el = resolver ? resolved?.element : (window.__simAgentElements || [])[id]
  if (!el || !el.isConnected) return { error: 'stale', reason: window.__simAgentStaleReason }

  const isWritableTextField = (
    field: HTMLInputElement | HTMLTextAreaElement
  ): 'writable' | 'disabled' | 'readonly' | 'not-editable' => {
    if (field.disabled || field.getAttribute('aria-disabled') === 'true') return 'disabled'
    if (field.readOnly || field.getAttribute('aria-readonly') === 'true') return 'readonly'
    if (String(field.tagName || '').toUpperCase() === 'TEXTAREA') return 'writable'
    const type = String((field as HTMLInputElement).type || 'text').toLowerCase()
    return ['text', 'search', 'email', 'url', 'tel', 'number'].includes(type)
      ? 'writable'
      : 'not-editable'
  }

  const potentialEditables: HTMLElement[] = []
  const addEditable = (node: Element): void => {
    const candidateTag = String(node.tagName || '').toUpperCase()
    const inputType =
      candidateTag === 'INPUT'
        ? String((node as HTMLInputElement).type || 'text').toLowerCase()
        : ''
    if (
      candidateTag === 'TEXTAREA' ||
      (candidateTag === 'INPUT' &&
        ['text', 'search', 'email', 'url', 'tel', 'number', 'password'].includes(inputType)) ||
      (node as HTMLElement).isContentEditable ||
      // An ARIA-only textbox. The snapshot already advertises these as
      // `[textbox]` with a ref, and browser_insert_text accepts them, so
      // refusing here meant one tool rejecting exactly what the outline told
      // the model to type into and what its sibling would have accepted.
      node.getAttribute('role') === 'textbox'
    ) {
      potentialEditables.push(node as HTMLElement)
    }
  }
  addEditable(el)
  for (const candidate of Array.from(
    el.querySelectorAll<HTMLElement>(
      'input, textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [role="textbox"]'
    )
  )) {
    addEditable(candidate)
  }
  const editables = Array.from(new Set(potentialEditables))
  if (editables.length === 0) {
    // Describe the element instead of only refusing it. Without this the agent
    // cannot tell "wrong ref" from "this tool cannot type here" and retries
    // variations of the same failing call.
    return {
      error: 'not-editable',
      elementTag: String(el.tagName || '').toLowerCase(),
      ...(el.getAttribute('role') ? { elementRole: el.getAttribute('role') } : {}),
    }
  }
  if (editables.length > 1) {
    // The candidate list is right here; discarding it left the agent unable to
    // pick a narrower target, which is the only recovery this error allows.
    return {
      error: 'ambiguous-editable',
      candidates: editables.slice(0, 5).map((field) => {
        const fieldTag = String(field.tagName || '').toLowerCase()
        const label = field.getAttribute('aria-label') || field.getAttribute('placeholder') || ''
        return label ? `${fieldTag} "${label}"` : fieldTag
      }),
    }
  }
  const editable = editables[0]
  const tag = String(editable.tagName || '').toUpperCase()
  editable.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
  if (isSecretField(editable)) return { error: 'password' }

  let submissionTarget: HTMLElement = editable
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    const field = editable as HTMLInputElement | HTMLTextAreaElement
    const writable = isWritableTextField(field)
    if (writable !== 'writable') return { error: writable }
    field.focus()
    // The native setter must come from the element's OWN realm. A same-origin
    // iframe has its own constructors, and calling the top frame's setter on
    // one of its nodes throws "Illegal invocation".
    const view = editable.ownerDocument.defaultView ?? window
    const proto =
      tag === 'INPUT' ? view.HTMLInputElement.prototype : view.HTMLTextAreaElement.prototype
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
    if (descriptor?.set) descriptor.set.call(field, text)
    else field.value = text
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
  } else {
    if (editable.getAttribute('aria-disabled') === 'true') return { error: 'disabled' }
    if (editable.getAttribute('aria-readonly') === 'true') return { error: 'readonly' }
    submissionTarget = editable
    editable.focus()
    editable.textContent = text
    editable.dispatchEvent(
      new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' })
    )
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
    const notCancelled = submissionTarget.dispatchEvent(new KeyboardEvent('keydown', key))
    submissionTarget.dispatchEvent(new KeyboardEvent('keyup', key))
    const form =
      (submissionTarget as HTMLInputElement).form ?? submissionTarget.closest?.('form') ?? null
    if (notCancelled && form) {
      if (typeof form.requestSubmit === 'function') form.requestSubmit()
      else form.submit()
    }
  }
  return {
    dispatched: true,
    replacedExisting: true,
    submitRequested: submit === true,
    submitDispatched: submit === true,
    submitted: false,
    submitUncertain: false,
    submissionEffectObserved: false,
    refRecovered: resolved?.recovered === true,
  }
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
    if (!node || String(node.tagName || '').toUpperCase() !== 'INPUT') return false
    if (String((node as HTMLInputElement).type || '').toLowerCase() === 'password') return true
    const hint = String(node.getAttribute('autocomplete') || '').toLowerCase()
    return hint
      .split(/\s+/)
      .some((token) => token === 'current-password' || token === 'new-password')
  }

  // Descend to what is really focused, like every other focus reader here.
  // Without this the synthetic key lands on the shadow HOST or the <iframe>
  // element: the event bubbles from there but never enters the shadow tree or
  // the frame document, so the editor's keymap never sees it — and the result
  // still reports success. It also made this function's `target` disagree with
  // the `activeElement` reported alongside it in the same tool result.
  let target = (document.activeElement as HTMLElement | null) ?? document.body
  for (let depth = 0; depth < 10; depth++) {
    const shadow = target.shadowRoot
    if (shadow?.activeElement) {
      target = shadow.activeElement as HTMLElement
      continue
    }
    const targetTag = String(target.tagName || '').toUpperCase()
    if (targetTag === 'IFRAME' || targetTag === 'FRAME') {
      try {
        const inner = (target as HTMLIFrameElement).contentDocument
        if (inner?.activeElement && inner.activeElement !== inner.body) {
          target = inner.activeElement as HTMLElement
          continue
        }
      } catch {
        // Cross-origin frame — not inspectable; dispatch to the frame itself.
      }
    }
    break
  }
  // The driver checks focus before taking the trusted CDP path; this covers
  // the synthetic fallback, which is reached independently when CDP is down.
  // Descending first is what makes this guard reach a password field nested in
  // a shadow root or frame, rather than only inspecting the host.
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

/**
 * Captures non-sensitive page state around a trusted input event. The driver
 * compares two readings so “the event was dispatched” is never confused with
 * “the page visibly reacted.”
 * Registered-node waits return only target state, without action ref recovery
 * or the broader page-effect scan.
 */
export function readPageActionState(
  resetMutationRevision = false,
  elementId?: number,
  targetResolution: 'actionable' | 'registered' = 'actionable'
): unknown {
  const registeredElement =
    typeof elementId === 'number' ? (window.__simAgentElements || [])[elementId] : undefined
  const resolver = window.__simAgentResolveElement
  if (targetResolution === 'registered') {
    if (!registeredElement) return { error: 'stale' }
    if (registeredElement.ownerDocument !== document) return { error: 'framed-wait' }
  }
  const resolved =
    typeof elementId === 'number'
      ? resolver && targetResolution === 'actionable'
        ? resolver(elementId)
        : registeredElement?.isConnected
          ? { element: registeredElement, recovered: false }
          : null
      : undefined
  const observedElement = resolved?.element ?? null
  const observedDocument =
    observedElement?.ownerDocument ?? registeredElement?.ownerDocument ?? document
  const observedWindow = observedDocument.defaultView ?? window
  const isEffectivelyRendered = (element: Element): boolean => {
    const rect = element.getBoundingClientRect()
    const view = element.ownerDocument.defaultView
    if (
      !view ||
      rect.width <= 1 ||
      rect.height <= 1 ||
      rect.right <= 0 ||
      rect.bottom <= 0 ||
      rect.left >= view.innerWidth ||
      rect.top >= view.innerHeight
    ) {
      return false
    }
    for (let current: Element | null = element; current; ) {
      const currentView: Window | null = current.ownerDocument.defaultView
      const style = currentView?.getComputedStyle(current)
      const opacity = Number.parseFloat(style?.opacity || '1')
      if (
        !style ||
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.contentVisibility === 'hidden' ||
        (Number.isFinite(opacity) && opacity <= 0.01) ||
        current.hasAttribute('hidden') ||
        current.getAttribute('aria-hidden') === 'true'
      ) {
        return false
      }
      if (current.parentElement) current = current.parentElement
      else {
        const root = current.getRootNode()
        current = 'host' in root ? (root.host as Element) : null
      }
    }
    return true
  }

  const targetState =
    typeof elementId !== 'number'
      ? undefined
      : observedElement
        ? {
            present: true,
            rendered: isEffectivelyRendered(observedElement),
            ariaExpanded: observedElement.getAttribute('aria-expanded'),
            ariaSelected: observedElement.getAttribute('aria-selected'),
            ariaPressed: observedElement.getAttribute('aria-pressed'),
            ariaChecked: observedElement.getAttribute('aria-checked'),
            checked:
              observedElement.tagName !== 'INPUT' ||
              !['checkbox', 'radio'].includes((observedElement as HTMLInputElement).type)
                ? undefined
                : (observedElement as HTMLInputElement).indeterminate === true
                  ? 'mixed'
                  : Boolean((observedElement as HTMLInputElement).checked),
            disabled:
              observedElement.matches(':disabled') ||
              observedElement.closest('[aria-disabled="true"]') !== null,
            selected:
              'selected' in observedElement
                ? Boolean((observedElement as HTMLOptionElement).selected)
                : undefined,
            open: observedElement.hasAttribute('open'),
            hidden:
              observedElement.hasAttribute('hidden') ||
              observedElement.getAttribute('aria-hidden') === 'true',
          }
        : { present: false, rendered: false }
  if (targetResolution === 'registered') return { targetState }

  const observationRoot = observedDocument.body

  const roots: ParentNode[] = observationRoot ? [observationRoot] : []
  const allElements: Element[] = []
  const stateNodeCap = 12_000
  for (let index = 0; index < roots.length; index++) {
    for (const element of Array.from(roots[index].querySelectorAll('*'))) {
      if (allElements.length >= stateNodeCap) break
      allElements.push(element)
      const shadow = (element as HTMLElement).shadowRoot
      if (shadow) roots.push(shadow)
    }
    if (allElements.length >= stateNodeCap) break
  }

  const mutationOptions: MutationObserverInit = {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      'aria-activedescendant',
      'aria-expanded',
      'aria-hidden',
      'aria-selected',
      'checked',
      'disabled',
      'hidden',
      'open',
      'selected',
    ],
  }
  const mutationStates = (window.__simAgentMutationStates ??= [])
  let mutationState = observationRoot
    ? mutationStates.find((state) => state.root === observationRoot)
    : undefined
  if (!mutationState && observationRoot) {
    mutationState = {
      root: observationRoot,
      observer: null as unknown as MutationObserver,
      revision: 0,
      observedRoots: new WeakSet<ParentNode>(),
    }
    const state = mutationState
    state.observer = new MutationObserver((records) => {
      state.revision += records.length
    })
    mutationStates.push(state)
    if (mutationStates.length > 10) mutationStates.shift()?.observer.disconnect()
  }
  // Observe on EVERY call, not only the first. The roots list is rebuilt each
  // time and grows as shadow roots mount, so attaching once left every
  // component that appeared later unobserved — its DOM changes raised no
  // revision, and an action that mounted UI inside one reported no effect at
  // all. `observe` on an already-observed root with the same options is a
  // documented no-op, and observedRoots keeps the common case cheap.
  if (mutationState) {
    const state = mutationState
    for (const root of roots) {
      if (state.observedRoots.has(root)) continue
      state.observer.observe(root as Node, mutationOptions)
      state.observedRoots.add(root)
    }
  }
  if (resetMutationRevision) {
    mutationState?.observer.takeRecords()
    if (mutationState) mutationState.revision = 0
  }

  let active = observedDocument.activeElement as HTMLElement | null
  for (let depth = 0; active && depth < 10; depth++) {
    if (active.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement as HTMLElement
      continue
    }
    const tag = String(active.tagName || '').toUpperCase()
    if (tag === 'IFRAME' || tag === 'FRAME') {
      try {
        const inner = (active as HTMLIFrameElement).contentDocument
        if (inner?.activeElement && inner.activeElement !== inner.body) {
          active = inner.activeElement as HTMLElement
          continue
        }
      } catch {
        // Cross-origin frame — report the frame itself.
      }
    }
    break
  }

  const dialogs = allElements.filter((element) =>
    element.matches('dialog[open], [role="dialog"], [aria-modal="true"]')
  )
  const visibleDialogLabels = dialogs
    .filter((element) => {
      const rect = element.getBoundingClientRect()
      const view = element.ownerDocument.defaultView
      if (!view || rect.width <= 0 || rect.height <= 0) return false
      for (let current: Element | null = element; current; ) {
        const style = view.getComputedStyle(current)
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          Number.parseFloat(style.opacity || '1') <= 0.01 ||
          current.hasAttribute('hidden') ||
          current.getAttribute('aria-hidden') === 'true'
        ) {
          return false
        }
        if (current.parentElement) current = current.parentElement
        else {
          const root = current.getRootNode()
          current = 'host' in root ? (root.host as Element) : null
        }
      }
      return (
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < view.innerWidth &&
        rect.top < view.innerHeight
      )
    })
    .slice(0, 10)
    .map((element) =>
      (
        element.getAttribute('aria-label') ||
        (element as HTMLElement).innerText ||
        element.textContent ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120)
        .replace(/[\uD800-\uDBFF]$/, '')
    )

  // Roles an app uses for something that APPEARS over the page. The first three
  // were the whole list, which missed the most common hover affordance there
  // is: a row's action bar (Slack's message shortcuts is role="toolbar"/"group"
  // with an aria-label). A hover that mounted one produced no popup change, no
  // target change, and so no observed effect at all — the agent concluded its
  // hover had failed and escalated to clicking pixels.
  const visiblePopupLabels = allElements
    .filter((element) =>
      element.matches(
        '[role="tooltip"], [role="menu"], [role="listbox"], [role="toolbar"], [role="menubar"], [role="group"][aria-label], [popover]'
      )
    )
    .filter((element) => {
      const rect = element.getBoundingClientRect()
      const view = element.ownerDocument.defaultView
      if (!view || rect.width <= 0 || rect.height <= 0) return false
      const style = view.getComputedStyle(element)
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number.parseFloat(style.opacity || '1') > 0.01 &&
        element.getAttribute('aria-hidden') !== 'true' &&
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < view.innerWidth &&
        rect.top < view.innerHeight
      )
    })
    .slice(0, 10)
    .map((element) =>
      (
        element.getAttribute('aria-label') ||
        (element as HTMLElement).innerText ||
        element.textContent ||
        element.getAttribute('role') ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120)
        .replace(/[\uD800-\uDBFF]$/, '')
    )

  const scrolledRegions = allElements
    .filter((element) => (element as HTMLElement).scrollTop !== 0)
    .slice(0, 30)
    .map((element) => `${element.tagName}:${Math.round((element as HTMLElement).scrollTop)}`)

  return {
    url: observedWindow.location.href.slice(0, 4096),
    title: observedDocument.title.slice(0, 500),
    focus:
      !active || active === active.ownerDocument.body
        ? 'body'
        : [
            active.tagName.toLowerCase(),
            active.getAttribute('role') || '',
            active.getAttribute('id') || '',
            active.getAttribute('name') || '',
            active.getAttribute('aria-label') || '',
          ].join(':'),
    mutationRevision: mutationState?.revision || 0,
    dialogs: visibleDialogLabels,
    popups: visiblePopupLabels,
    scroll: [Math.round(observedWindow.scrollY), ...scrolledRegions],
    ...(targetState ? { targetState } : {}),
    observationTruncated: allElements.length >= stateNodeCap,
  }
}

export function scrollPage(direction: string, amount?: number, elementId?: number): unknown {
  const distance = typeof amount === 'number' && amount > 0 ? amount : window.innerHeight * 0.85
  const delta = direction === 'up' ? -distance : distance
  const scrollingElement = (document.scrollingElement || document.documentElement) as HTMLElement

  const isVisible = (element: Element): boolean => {
    const rect = element.getBoundingClientRect()
    const view = element.ownerDocument.defaultView
    if (!view || rect.width <= 0 || rect.height <= 0) return false
    if (
      rect.right <= 0 ||
      rect.bottom <= 0 ||
      rect.left >= view.innerWidth ||
      rect.top >= view.innerHeight
    ) {
      return false
    }
    for (let current: Element | null = element; current; ) {
      const currentView: Window | null = current.ownerDocument.defaultView
      const style = currentView?.getComputedStyle(current)
      const opacity = Number.parseFloat(style?.opacity || '1')
      if (
        !style ||
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.contentVisibility === 'hidden' ||
        (Number.isFinite(opacity) && opacity <= 0.01) ||
        current.hasAttribute('hidden') ||
        current.getAttribute('aria-hidden') === 'true'
      ) {
        return false
      }
      if (current.parentElement) current = current.parentElement
      else {
        const root = current.getRootNode()
        if ('host' in root) current = root.host as Element
        else {
          const frame: Element | null = current.ownerDocument.defaultView?.frameElement ?? null
          current = frame
        }
      }
    }
    return true
  }
  const isScrollable = (element: Element): element is HTMLElement => {
    const html = element as HTMLElement
    if (html.scrollHeight <= html.clientHeight + 1) return false
    const ownerScroller =
      element.ownerDocument.scrollingElement || element.ownerDocument.documentElement
    if (element === ownerScroller) return true
    const view = element.ownerDocument.defaultView
    if (!view) return false
    const overflow = view.getComputedStyle(element).overflowY
    return overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay'
  }
  const canMove = (element: HTMLElement): boolean => {
    const max = Math.max(0, element.scrollHeight - element.clientHeight)
    return direction === 'up' ? element.scrollTop > 1 : element.scrollTop < max - 1
  }
  const ancestors = (start: Element | null): HTMLElement[] => {
    const result: HTMLElement[] = []
    let current = start
    while (current) {
      if (isScrollable(current) && isVisible(current)) result.push(current)
      const root = current.getRootNode()
      if (current.parentElement) current = current.parentElement
      else if ('host' in root && root.host) current = root.host as Element
      else {
        const frame = current.ownerDocument.defaultView?.frameElement
        current = frame ? (frame as Element) : null
      }
    }
    return result
  }
  const deepActiveElement = (): Element | null => {
    let active = document.activeElement
    for (let depth = 0; active && depth < 10; depth++) {
      if ((active as HTMLElement).shadowRoot?.activeElement) {
        active = (active as HTMLElement).shadowRoot?.activeElement ?? active
        continue
      }
      const tag = String(active.tagName || '').toUpperCase()
      if (tag === 'IFRAME' || tag === 'FRAME') {
        try {
          const inner = (active as HTMLIFrameElement).contentDocument
          if (inner?.activeElement && inner.activeElement !== inner.body) {
            active = inner.activeElement
            continue
          }
        } catch {
          // Cross-origin frame — use the frame as the focus anchor.
        }
      }
      break
    }
    return active
  }

  let target: HTMLElement | undefined
  let boundaryFallback: HTMLElement | undefined
  let boundarySource = 'page'
  let source = 'page'
  if (typeof elementId === 'number') {
    const resolver = window.__simAgentResolveElement
    const resolved = resolver?.(elementId)
    const element = resolver ? resolved?.element : (window.__simAgentElements || [])[elementId]
    if (!element || !element.isConnected)
      return { error: 'stale', reason: window.__simAgentStaleReason }
    const candidates = ancestors(element)
    target = candidates.find(canMove) ?? candidates[0]
    source = target && canMove(target) ? 'element' : 'element-boundary'
  }
  if (!target) {
    const focused = ancestors(deepActiveElement())
    const movable = focused.find(canMove)
    if (movable) {
      target = movable
      source = 'focus'
    } else if (focused[0]) {
      boundaryFallback = focused[0]
      boundarySource = 'focus-boundary'
    }
  }
  if (!target && typeof document.elementsFromPoint === 'function') {
    const centered = document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2)
    for (const element of centered) {
      const candidates = ancestors(element)
      const movable = candidates.find(canMove)
      if (movable) {
        target = movable
        source = 'viewport-center'
        break
      }
      if (candidates[0] && boundarySource !== 'viewport-center-boundary') {
        boundaryFallback = candidates[0]
        boundarySource = 'viewport-center-boundary'
      }
    }
  }
  // A focused or center-hit pane is an explicit affinity signal. If it is at
  // the requested boundary, report a zero move there instead of wandering to
  // an unrelated movable sidebar and calling that success.
  if (!target && boundaryFallback) {
    target = boundaryFallback
    source = boundarySource
  }
  if (!target) {
    const scanCap = 12_000
    const roots: ParentNode[] = [document]
    const scanned: Element[] = []
    for (let rootIndex = 0; rootIndex < roots.length && scanned.length < scanCap; rootIndex++) {
      for (const element of Array.from(roots[rootIndex].querySelectorAll('*'))) {
        if (scanned.length >= scanCap) break
        scanned.push(element)
        const shadow = (element as HTMLElement).shadowRoot
        if (shadow) roots.push(shadow)
      }
    }
    const candidates = scanned
      .filter((element): element is HTMLElement => isScrollable(element) && isVisible(element))
      .filter(canMove)
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect()
        const bRect = b.getBoundingClientRect()
        return bRect.width * bRect.height - aRect.width * aRect.height
      })
    target = candidates[0]
    if (target) source = 'largest-visible'
  }
  target ??= scrollingElement

  const targetDocument = target.ownerDocument
  const targetWindow = targetDocument.defaultView
  const targetDocumentScroller = targetDocument.scrollingElement || targetDocument.documentElement
  const isDocumentScroller = target === targetDocumentScroller
  const before = isDocumentScroller ? (targetWindow?.scrollY ?? target.scrollTop) : target.scrollTop
  if (isDocumentScroller && targetWindow) {
    targetWindow.scrollBy({ top: delta, behavior: 'instant' })
  } else if (typeof target.scrollBy === 'function') {
    target.scrollBy({ top: delta, behavior: 'instant' })
  } else {
    target.scrollTop += delta
  }
  const scrollTop = isDocumentScroller
    ? (targetWindow?.scrollY ?? target.scrollTop)
    : target.scrollTop
  const scrollHeight = isDocumentScroller
    ? targetDocument.documentElement.scrollHeight
    : target.scrollHeight
  const clientHeight = isDocumentScroller
    ? (targetWindow?.innerHeight ?? target.clientHeight)
    : target.clientHeight
  const label =
    target.getAttribute('aria-label') ||
    target.getAttribute('role') ||
    target.getAttribute('id') ||
    target.tagName.toLowerCase()
  return {
    target: label,
    targetSource: source,
    scrollTop: Math.round(scrollTop),
    scrollHeight: Math.round(scrollHeight),
    clientHeight: Math.round(clientHeight),
    movedBy: Math.round(scrollTop - before),
    atTop: scrollTop <= 1,
    atBottom: scrollTop + clientHeight >= scrollHeight - 2,
    windowScrollY: Math.round(window.scrollY),
  }
}

export function selectOptionInElement(id: number, value: string): unknown {
  const resolver = window.__simAgentResolveElement
  const resolved = resolver?.(id)
  const el = resolver ? resolved?.element : (window.__simAgentElements || [])[id]
  if (!el || !el.isConnected) return { error: 'stale', reason: window.__simAgentStaleReason }
  if (String(el.tagName || '').toUpperCase() !== 'SELECT') return { error: 'not-select' }
  const select = el as HTMLSelectElement
  if (select.disabled || select.getAttribute('aria-disabled') === 'true') {
    return { error: 'disabled' }
  }
  const wanted = value.trim().toLowerCase()
  const option = Array.from(select.options).find(
    (o) => o.value.trim().toLowerCase() === wanted || o.label.trim().toLowerCase() === wanted
  )
  if (!option) {
    return {
      error: 'no-option',
      options: Array.from(select.options)
        .slice(0, 50)
        .map((o) =>
          o.label
            .trim()
            .slice(0, 200)
            .replace(/[\uD800-\uDBFF]$/, '')
        ),
    }
  }
  if (option.disabled || (option.parentElement as HTMLOptGroupElement | null)?.disabled === true) {
    return { error: 'disabled' }
  }
  select.value = option.value
  select.dispatchEvent(new Event('input', { bubbles: true }))
  select.dispatchEvent(new Event('change', { bubbles: true }))
  return {
    selected: option.label.trim(),
    value: option.value,
    refRecovered: resolved?.recovered === true,
  }
}

export function readSelectElementState(id: number): unknown {
  const resolver = window.__simAgentResolveElement
  const resolved = resolver?.(id)
  const el = resolver ? resolved?.element : (window.__simAgentElements || [])[id]
  if (!el || !el.isConnected) return { error: 'stale', reason: window.__simAgentStaleReason }
  if (String(el.tagName || '').toUpperCase() !== 'SELECT') return { error: 'not-select' }
  const select = el as HTMLSelectElement
  return {
    selected: select.selectedOptions[0]?.label.trim() || '',
    value: select.value,
  }
}

export function readCheckableElementState(id: number): unknown {
  const resolver = window.__simAgentResolveElement
  const resolved = resolver?.(id)
  const registered = resolver ? resolved?.element : (window.__simAgentElements || [])[id]
  const candidate =
    String(registered?.tagName || '').toUpperCase() === 'LABEL'
      ? (registered as HTMLLabelElement).control
      : registered
  if (!candidate || !candidate.isConnected) {
    return { error: 'stale', reason: window.__simAgentStaleReason }
  }

  const tag = String(candidate.tagName || '').toUpperCase()
  const type =
    tag === 'INPUT' ? String((candidate as HTMLInputElement).type || '').toLowerCase() : ''
  const role = String(candidate.getAttribute('role') || '').toLowerCase()
  const isNative = tag === 'INPUT' && (type === 'checkbox' || type === 'radio')
  const isAria = ['checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio'].includes(role)
  if (!isNative && !isAria) return { error: 'not-checkable' }

  const ariaChecked = candidate.getAttribute('aria-checked')
  const checked = isNative
    ? (candidate as HTMLInputElement).indeterminate
      ? 'mixed'
      : Boolean((candidate as HTMLInputElement).checked)
    : ariaChecked === 'true'
      ? true
      : ariaChecked === 'false'
        ? false
        : ariaChecked
  return {
    checked,
    disabled:
      candidate.matches(':disabled') || candidate.closest('[aria-disabled="true"]') !== null,
    readOnly:
      (candidate as Element & { readOnly?: boolean }).readOnly === true ||
      candidate.getAttribute('aria-readonly') === 'true',
    kind: isNative ? `input:${type}` : `role:${role}`,
    refRecovered: resolved?.recovered === true,
  }
}

export function getElementScreenshotRect(id: number): unknown {
  const resolver = window.__simAgentResolveElement
  const resolved = resolver?.(id)
  const element = resolver ? resolved?.element : (window.__simAgentElements || [])[id]
  if (!element || !element.isConnected) {
    return { error: 'stale', reason: window.__simAgentStaleReason }
  }

  if (element.ownerDocument !== document) return { error: 'framed-screenshot' }
  const rect = element.getBoundingClientRect()
  const view = element.ownerDocument.defaultView
  if (!view) return { error: 'stale', reason: window.__simAgentStaleReason }
  for (let current: Element | null = element; current; ) {
    const currentView: Window | null = current.ownerDocument.defaultView
    const style = currentView?.getComputedStyle(current)
    const opacity = Number.parseFloat(style?.opacity || '1')
    if (
      !style ||
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.contentVisibility === 'hidden' ||
      (Number.isFinite(opacity) && opacity <= 0.01) ||
      current.hasAttribute('hidden') ||
      current.getAttribute('aria-hidden') === 'true'
    ) {
      return { error: 'not-visible' }
    }
    if (current.parentElement) current = current.parentElement
    else {
      const root = current.getRootNode()
      current = 'host' in root ? (root.host as Element) : null
    }
  }

  const left = Math.max(0, rect.left)
  const top = Math.max(0, rect.top)
  const right = Math.min(view.innerWidth, rect.right)
  const bottom = Math.min(view.innerHeight, rect.bottom)
  if (right - left <= 1 || bottom - top <= 1) return { error: 'not-visible' }
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    element: element.tagName.toLowerCase().slice(0, 80),
    refRecovered: resolved?.recovered === true,
  }
}

export function hoverElement(id: number): unknown {
  const resolver = window.__simAgentResolveElement
  const resolved = resolver?.(id)
  const el = resolver ? resolved?.element : (window.__simAgentElements || [])[id]
  if (!el || !el.isConnected) return { error: 'stale', reason: window.__simAgentStaleReason }
  el.scrollIntoView({ block: 'center', behavior: 'instant' })
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
  return { hovered: true, refRecovered: resolved?.recovered === true }
}

/**
 * Resolves one child frame's embedding element from its parent frame and
 * verifies that the surface is rendered, onscreen, and not covered. This is
 * evaluated in the parent because a cross-origin child cannot inspect its own
 * <iframe> element.
 */
export function readChildFrameElementState(
  frameName: string,
  frameUrl: string,
  frameOrigin: string,
  childIndex: number,
  childX?: number,
  childY?: number
): unknown {
  const frames: HTMLElement[] = []
  const roots: ParentNode[] = [document]
  let visited = 0
  for (let index = 0; index < roots.length && visited < 12_000; index++) {
    frames.push(...(Array.from(roots[index].querySelectorAll('iframe, frame')) as HTMLElement[]))
    for (const element of Array.from(roots[index].querySelectorAll('*'))) {
      visited++
      if (visited >= 12_000) break
      const shadow = (element as HTMLElement).shadowRoot
      if (shadow) roots.push(shadow)
    }
  }
  const one = (candidates: HTMLElement[]): HTMLElement | null =>
    candidates.length === 1 ? candidates[0] : null
  const directFrameWindow =
    Number.isInteger(childIndex) && childIndex >= 0 ? window.frames[childIndex] : undefined
  // WindowProxy identity is readable across origins and ties Electron's direct
  // child-frame index to the actual embedding element. Do this before semantic
  // name/URL fallbacks: duplicate account widgets commonly share all of those
  // strings, and a flattened DOM index can prove visibility on the wrong twin.
  let element = directFrameWindow
    ? one(
        frames.filter((candidate) => {
          try {
            return (candidate as HTMLIFrameElement).contentWindow === directFrameWindow
          } catch {
            return false
          }
        })
      )
    : null
  if (!element && frameName) {
    element = one(
      frames.filter(
        (frame) =>
          frame.getAttribute('name') === frameName ||
          (frame as HTMLIFrameElement).name === frameName
      )
    )
  }
  if (!element) {
    element = one(
      frames.filter((frame) => {
        try {
          return (frame as HTMLIFrameElement).src === frameUrl
        } catch {
          return false
        }
      })
    )
  }
  if (!element && frameOrigin && frameOrigin !== 'null') {
    element = one(
      frames.filter((frame) => {
        try {
          return new URL((frame as HTMLIFrameElement).src, document.baseURI).origin === frameOrigin
        } catch {
          return false
        }
      })
    )
  }
  if (!element) return { known: false, visible: false }

  const view = element.ownerDocument.defaultView
  const rect = element.getBoundingClientRect()
  let visible = Boolean(
    view &&
      rect.width > 1 &&
      rect.height > 1 &&
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < view.innerWidth &&
      rect.top < view.innerHeight
  )
  let pointMappingReliable = true
  for (let current: Element | null = element; visible && current; ) {
    const style = view?.getComputedStyle(current)
    if (
      !style ||
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      Number.parseFloat(style.opacity || '1') <= 0.01 ||
      current.hasAttribute('hidden') ||
      current.getAttribute('aria-hidden') === 'true'
    ) {
      visible = false
      break
    }
    if (style.transform && style.transform !== 'none') {
      try {
        if (typeof DOMMatrixReadOnly !== 'function') {
          pointMappingReliable = false
        } else {
          const matrix = new DOMMatrixReadOnly(style.transform)
          if (
            !matrix.is2D ||
            Math.abs(matrix.b) > 0.0001 ||
            Math.abs(matrix.c) > 0.0001 ||
            matrix.a <= 0 ||
            matrix.d <= 0
          ) {
            pointMappingReliable = false
          }
        }
      } catch {
        pointMappingReliable = false
      }
    }
    if (current.parentElement) current = current.parentElement
    else {
      const root = current.getRootNode()
      current = 'host' in root ? (root.host as Element) : null
    }
  }

  const frame = element as HTMLIFrameElement
  const scaleX = element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1
  const scaleY = element.offsetHeight > 0 ? rect.height / element.offsetHeight : 1
  const hasPoint = typeof childX === 'number' && typeof childY === 'number'
  const mappedX = hasPoint
    ? rect.left + ((childX as number) + element.clientLeft) * scaleX
    : rect.left + rect.width / 2
  const mappedY = hasPoint
    ? rect.top + ((childY as number) + element.clientTop) * scaleY
    : rect.top + rect.height / 2
  const hitPoints = hasPoint
    ? [[mappedX, mappedY]]
    : [
        [mappedX, mappedY],
        [rect.left + rect.width * 0.2, rect.top + rect.height * 0.2],
        [rect.left + rect.width * 0.8, rect.top + rect.height * 0.2],
        [rect.left + rect.width * 0.2, rect.top + rect.height * 0.8],
        [rect.left + rect.width * 0.8, rect.top + rect.height * 0.8],
      ]
  let blocker: Element | null = null
  let surfaceVisible = false
  const hitTestRoot = element.getRootNode() as ParentNode & {
    elementFromPoint?: (x: number, y: number) => Element | null
  }
  const elementAtPoint =
    typeof hitTestRoot.elementFromPoint === 'function'
      ? hitTestRoot.elementFromPoint.bind(hitTestRoot)
      : typeof element.ownerDocument.elementFromPoint === 'function'
        ? element.ownerDocument.elementFromPoint.bind(element.ownerDocument)
        : null
  if (visible && elementAtPoint) {
    for (const [x, y] of hitPoints) {
      const hit = elementAtPoint(x, y)
      if (hit === element) {
        surfaceVisible = true
        break
      }
      blocker ??= hit
    }
  } else if (visible) {
    // DOM-only test environments may not implement hit testing.
    surfaceVisible = true
  }
  const blockerLabel = (
    blocker?.getAttribute('aria-label') ||
    (blocker as HTMLElement | null)?.innerText ||
    blocker?.textContent ||
    blocker?.tagName ||
    ''
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .replace(/[\uD800-\uDBFF]$/, '')
  return {
    known: true,
    visible: visible && surfaceVisible,
    mappedX,
    mappedY,
    pointMappingReliable,
    blocker: blockerLabel,
    frameName: frame.name || frame.getAttribute('name') || '',
  }
}

export function readPageText(id?: number): unknown {
  const maxChars = 30000
  let text: string
  if (typeof id === 'number') {
    const resolver = window.__simAgentResolveElement
    const resolved = resolver?.(id)
    const el = resolver ? resolved?.element : (window.__simAgentElements || [])[id]
    if (!el || !el.isConnected) return { error: 'stale', reason: window.__simAgentStaleReason }
    text = (el as HTMLElement).innerText ?? el.textContent ?? ''
  } else {
    text = document.body?.innerText ?? ''
  }
  const trimmed = text.replace(/\n{3,}/g, '\n\n').trim()
  return {
    url: window.location.href.slice(0, 4096),
    title: document.title.slice(0, 500),
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
    url: window.location.href.slice(0, 4096),
    title: document.title.slice(0, 500),
    width: window.innerWidth,
    height: window.innerHeight,
  }
}

/**
 * Describes whatever sits at a viewport point, descending through open shadow
 * roots and same-origin iframes. Coordinate-addressed actions have no
 * snapshot ref to revalidate, so this probe is their safety check: the driver
 * refuses file inputs outright and reports what the point resolves to so the
 * model can confirm it hit what the screenshot showed.
 */
export function describePointTarget(x: number, y: number): unknown {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x >= window.innerWidth ||
    y >= window.innerHeight
  ) {
    return { error: 'outside-viewport' }
  }

  let doc: Document = document
  let localX = x
  let localY = y
  let element: Element | null = null
  for (let depth = 0; depth < 10; depth++) {
    if (typeof doc.elementFromPoint !== 'function') break
    let found: Element | null = doc.elementFromPoint(localX, localY)
    // Open shadow roots re-hit-test at the same point until a leaf host.
    for (let shadowDepth = 0; shadowDepth < 10; shadowDepth++) {
      const shadow = (found as HTMLElement | null)?.shadowRoot
      const inner = shadow?.elementFromPoint(localX, localY)
      if (!inner || inner === found) break
      found = inner
    }
    element = found
    const tag = String(found?.tagName || '').toUpperCase()
    if ((tag !== 'IFRAME' && tag !== 'FRAME') || !found) break
    try {
      const innerDoc = (found as HTMLIFrameElement).contentDocument
      if (!innerDoc) break
      const rect = found.getBoundingClientRect()
      localX -= rect.left + (found as HTMLIFrameElement).clientLeft
      localY -= rect.top + (found as HTMLIFrameElement).clientTop
      doc = innerDoc
    } catch {
      // Cross-origin frame — cannot inspect further; report the frame itself.
      break
    }
  }
  if (!element) return { found: false }

  const tag = String(element.tagName || '').toUpperCase()
  const inputType =
    tag === 'INPUT' ? String((element as HTMLInputElement).type || 'text').toLowerCase() : ''
  const secret =
    tag === 'INPUT' &&
    (inputType === 'password' ||
      String(element.getAttribute('autocomplete') || '')
        .toLowerCase()
        .split(/\s+/)
        .some((token) => token === 'current-password' || token === 'new-password'))
  const editable = Boolean(
    tag === 'TEXTAREA' ||
      (tag === 'INPUT' &&
        ['text', 'search', 'email', 'url', 'tel', 'number', 'password'].includes(inputType)) ||
      (element as HTMLElement).isContentEditable
  )

  const name = (
    element.getAttribute('aria-label') ||
    element.getAttribute('title') ||
    element.getAttribute('alt') ||
    ((element as HTMLElement).innerText ?? element.textContent ?? '')
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  const role = element.getAttribute('role') || ''
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)

  return {
    found: true,
    element: name
      ? `${tag.toLowerCase()}${role ? `[${role}]` : ''} "${name}"`
      : `${tag.toLowerCase()}${role ? `[${role}]` : ''}`,
    tag: tag.toLowerCase(),
    role,
    editable,
    secret,
    fileInput: tag === 'INPUT' && inputType === 'file',
    disabled:
      (element as HTMLInputElement).disabled === true ||
      element.getAttribute('aria-disabled') === 'true',
    canvas: tag === 'CANVAS',
    crossOriginFrame: tag === 'IFRAME' || tag === 'FRAME',
    cursor: style?.cursor || '',
  }
}

/**
 * Reports whether the currently-focused element accepts text insertion, for
 * browser_insert_text — which types at the caret instead of addressing a
 * snapshot ref. Secrecy is separately (and authoritatively) probed by
 * activeElementSecrecy before any insertion.
 */
export function describeFocusedEditable(): unknown {
  // Descend shadow roots AND same-origin frames, matching activeElementReadback
  // exactly. Focus inside a frame surfaces on the outer document as the FRAME
  // element, which is not an input, not contentEditable, not a canvas and has no
  // textbox role — so stopping here reported a perfectly writable field as
  // `not-editable`, while press-key (which does descend) typed into it fine.
  // Any divergence between these two loops is a tool that refuses what its
  // sibling accepts on the same page state.
  let active = document.activeElement as HTMLElement | null
  for (let depth = 0; active && depth < 10; depth++) {
    const shadow = active.shadowRoot
    if (shadow?.activeElement) {
      active = shadow.activeElement as HTMLElement
      continue
    }
    const activeTag = String(active.tagName || '').toUpperCase()
    if (activeTag === 'IFRAME' || activeTag === 'FRAME') {
      try {
        const inner = (active as HTMLIFrameElement).contentDocument
        if (inner?.activeElement && inner.activeElement !== inner.body) {
          active = inner.activeElement as HTMLElement
          continue
        }
      } catch {
        // Cross-origin frame — not inspectable. The caller refuses separately on
        // opaque secrecy, so report the frame itself rather than guessing.
      }
    }
    break
  }
  if (!active || active === document.body) return { editable: false, reason: 'none' }
  const tag = String(active.tagName || '').toUpperCase()
  const inputType =
    tag === 'INPUT' ? String((active as HTMLInputElement).type || 'text').toLowerCase() : ''
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    const field = active as HTMLInputElement | HTMLTextAreaElement
    if (field.disabled || active.getAttribute('aria-disabled') === 'true') {
      return { editable: false, reason: 'disabled' }
    }
    if (field.readOnly || active.getAttribute('aria-readonly') === 'true') {
      return { editable: false, reason: 'readonly' }
    }
    if (
      tag === 'INPUT' &&
      !['text', 'search', 'email', 'url', 'tel', 'number', 'password'].includes(inputType)
    ) {
      return { editable: false, reason: 'not-text' }
    }
    return { editable: true, kind: tag === 'TEXTAREA' ? 'textarea' : `input:${inputType}` }
  }
  if (active.isContentEditable) {
    if (active.getAttribute('aria-disabled') === 'true') {
      return { editable: false, reason: 'disabled' }
    }
    if (active.getAttribute('aria-readonly') === 'true') {
      return { editable: false, reason: 'readonly' }
    }
    return { editable: true, kind: 'contenteditable' }
  }
  // A canvas-rendered editor (Google Docs) focuses a hidden proxy or the
  // canvas region itself; trusted IME insertion still reaches it, so report
  // it as insertable rather than refusing.
  if (tag === 'CANVAS' || active.getAttribute('role') === 'textbox') {
    return { editable: true, kind: tag === 'CANVAS' ? 'canvas' : 'textbox-role' }
  }
  // Describe what actually held focus. A bare "not-editable" tells the agent
  // nothing it can act on, so it guesses at the cause and burns rounds on the
  // wrong recovery; naming the element lets it click the real field instead.
  return {
    editable: false,
    reason: 'not-editable',
    focusedTag: tag.toLowerCase(),
    ...(active.getAttribute('role') ? { focusedRole: active.getAttribute('role') } : {}),
    contentEditable: String(active.getAttribute('contenteditable') ?? 'unset'),
  }
}
