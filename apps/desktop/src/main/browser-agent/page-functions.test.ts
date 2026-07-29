// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  activeElementSecrecy,
  clickElement,
  collectSnapshot,
  focusElementForTyping,
  getViewportInfo,
  hoverElement,
  pageContainsText,
  pressKeyOnPage,
  readActiveElementState,
  readPageText,
  scrollPage,
  selectOptionInElement,
  typeIntoElement,
} from '@/main/browser-agent/page-functions'

/**
 * These functions are serialized and run inside an arbitrary page, so they are
 * exercised here against a real DOM rather than mocks. jsdom omits a few
 * layout and pointer APIs the functions touch; the shims below supply the
 * minimum for the code paths under test, and `visible()` makes an element pass
 * `collectSnapshot`'s zero-size visibility filter.
 */
function installDomShims(): void {
  if (!('PointerEvent' in globalThis)) {
    // jsdom omits PointerEvent; MouseEvent carries the fields clickElement sets.
    Object.defineProperty(globalThis, 'PointerEvent', {
      value: MouseEvent,
      configurable: true,
    })
  }
  Element.prototype.scrollIntoView = () => {}
  window.scrollBy = () => {}
  if (!('innerText' in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      get(this: HTMLElement) {
        return this.textContent ?? ''
      },
      configurable: true,
    })
  }
}

/**
 * Runs a page function the way the driver does — serialized to source and
 * evaluated with only globals in scope. `new Function` deliberately skips the
 * module's lexical scope, so anything the function reaches for outside itself
 * fails here exactly as it would in a real page.
 */
function runSerialized(fn: (...args: never[]) => unknown, args: unknown[]): unknown {
  const expression = `(${String(fn)}).apply(null, ${JSON.stringify(args)})`
  return new Function(`return ${expression}`)()
}

function visible<T extends Element>(el: T): T {
  el.getBoundingClientRect = () =>
    ({ x: 0, y: 0, width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 }) as DOMRect
  return el
}

/**
 * Overrides the focus getter instead of calling `focus()`: jsdom's focus
 * handling varies across element types and frames, and every guard under test
 * keys off `document.activeElement`, not on real focus.
 */
function setActiveElement(doc: Document, el: Element | null): void {
  Object.defineProperty(doc, 'activeElement', { configurable: true, get: () => el })
}

/** Registers elements the way `collectSnapshot` does, so ids resolve. */
function register(...elements: Element[]): void {
  window.__simAgentElements = elements
}

function outlineOf(result: unknown): string {
  return (result as { outline: string }).outline
}

beforeEach(() => {
  installDomShims()
  document.body.innerHTML = ''
  window.__simAgentElements = []
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('serialization contract', () => {
  // The driver ships each of these to the page as `String(fn)`, so a reference
  // to anything in module scope — a shared helper, an import, a constant —
  // type-checks and passes every other test in this file, then throws
  // ReferenceError against a real page. The repeated `isSecretField` helpers
  // exist because of this constraint; these cases are what enforce it.
  const cases: Array<[string, (...args: never[]) => unknown, unknown[]]> = [
    ['collectSnapshot', collectSnapshot, []],
    ['clickElement', clickElement, [0]],
    ['focusElementForTyping', focusElementForTyping, [0]],
    ['typeIntoElement', typeIntoElement, [0, 'text', false]],
    ['readActiveElementState', readActiveElementState, []],
    ['activeElementSecrecy', activeElementSecrecy, []],
    ['pressKeyOnPage', pressKeyOnPage, ['a', 'KeyA', 65, false, false, false, false]],
    ['scrollPage', scrollPage, ['down', 100]],
    ['selectOptionInElement', selectOptionInElement, [0, 'value']],
    ['hoverElement', hoverElement, [0]],
    ['readPageText', readPageText, []],
    ['pageContainsText', pageContainsText, ['needle']],
    ['getViewportInfo', getViewportInfo, []],
  ]

  it.each(cases)('%s is self-contained', (_name, fn, args) => {
    document.body.innerHTML = '<input type="text" /><select><option value="v">V</option></select>'
    register(...Array.from(document.body.children).map(visible))

    expect(() => runSerialized(fn, args)).not.toThrow()
  })

  it('still refuses a password field when run as serialized source', () => {
    // The guards must survive the trip through String(fn), not just direct
    // invocation from this module.
    document.body.innerHTML = '<input type="password" />'
    register(visible(document.querySelector('input') as HTMLInputElement))
    setActiveElement(document, document.querySelector('input'))

    expect(runSerialized(clickElement, [0])).toEqual({ error: 'password' })
    expect(runSerialized(activeElementSecrecy, [])).toBe('secret')
    expect(runSerialized(readActiveElementState, [])).toMatchObject({ redacted: true })
  })
})

describe('secret-field detection', () => {
  const secretCases: Array<[string, string]> = [
    ['type=password', '<input type="password" />'],
    [
      'revealed password (type flipped to text)',
      '<input type="text" autocomplete="current-password" />',
    ],
    ['new-password field', '<input type="text" autocomplete="new-password" />'],
    ['uppercase autocomplete token', '<input type="text" autocomplete="Current-Password" />'],
    // The spec allows space-separated detail tokens and WebAuthn recommends
    // this exact value, so whole-string equality missed it.
    [
      'WebAuthn multi-token autocomplete',
      '<input type="text" autocomplete="current-password webauthn" />',
    ],
    [
      'section-scoped autocomplete',
      '<input type="text" autocomplete="section-login current-password" />',
    ],
    [
      'multi-token new-password with surrounding whitespace',
      '<input type="text" autocomplete="  new-password   webauthn  " />',
    ],
  ]

  it.each(secretCases)('clickElement refuses a %s', (_label, html) => {
    document.body.innerHTML = html
    const input = visible(document.querySelector('input') as HTMLInputElement)
    register(input)

    expect(clickElement(0)).toEqual({ error: 'password' })
  })

  it.each(secretCases)('typeIntoElement refuses a %s', (_label, html) => {
    document.body.innerHTML = html
    const input = document.querySelector('input') as HTMLInputElement
    register(input)

    expect(typeIntoElement(0, 'hunter2', false)).toEqual({ error: 'password' })
    expect(input.value).toBe('')
  })

  it.each(secretCases)('focusElementForTyping refuses a %s', (_label, html) => {
    document.body.innerHTML = html
    register(document.querySelector('input') as HTMLInputElement)

    expect(focusElementForTyping(0)).toEqual({ error: 'password' })
  })

  it('still allows ordinary fields and controls', () => {
    document.body.innerHTML =
      '<input type="text" name="q" /><button>Go</button><input type="email" autocomplete="username" />'
    const [text, , email] = Array.from(document.body.querySelectorAll('input, button')).map(visible)
    const button = visible(document.querySelector('button') as HTMLButtonElement)
    register(text, button, email)

    expect(typeIntoElement(0, 'search terms', false)).toMatchObject({ typed: true })
    expect(clickElement(1)).toMatchObject({ clicked: true })
    expect(focusElementForTyping(2)).toMatchObject({ focused: true })
  })

  it('detects a password field reached through a same-origin iframe', () => {
    // `instanceof HTMLInputElement` is realm-bound and returns false for nodes
    // owned by a frame, which is why detection matches on tagName instead.
    const frame = document.createElement('iframe')
    document.body.append(frame)
    const inner = frame.contentDocument as Document
    inner.body.innerHTML = '<input type="password" />'
    const nested = inner.querySelector('input') as HTMLInputElement

    expect(nested instanceof HTMLInputElement).toBe(false)
    register(nested)
    expect(clickElement(0)).toEqual({ error: 'password' })
  })
})

describe('elements inside a same-origin iframe', () => {
  /**
   * The snapshot walks into same-origin frames and hands the model ids for
   * what it finds, so every interaction has to work on them. `instanceof`
   * against the top frame's constructors is false for those nodes, which used
   * to make the driver report a real `<input>` as "not a text input" —
   * breaking framed login forms and editors like TinyMCE.
   */
  function framedBody(html: string): Document {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    const inner = frame.contentDocument as Document
    // The frame is its own realm, so the shims installed on the top document's
    // prototypes do not apply here — the same property that makes `instanceof`
    // fail across frames.
    const innerWindow = inner.defaultView as Window & typeof globalThis
    innerWindow.Element.prototype.scrollIntoView = () => {}
    inner.body.innerHTML = html
    return inner
  }

  it('types into a framed input', () => {
    const inner = framedBody('<input type="text" />')
    const field = inner.querySelector('input') as HTMLInputElement
    register(field)

    expect(field instanceof HTMLInputElement).toBe(false)
    expect(typeIntoElement(0, 'hello', false)).toMatchObject({ typed: true })
    expect(field.value).toBe('hello')
  })

  it('focuses a framed input for native typing', () => {
    const inner = framedBody('<input type="text" value="existing" />')
    register(inner.querySelector('input') as HTMLInputElement)

    expect(focusElementForTyping(0)).toMatchObject({ focused: true, kind: 'input' })
  })

  it('selects an option in a framed select', () => {
    const inner = framedBody(
      '<select><option value="a">A</option><option value="b">B</option></select>'
    )
    const select = inner.querySelector('select') as HTMLSelectElement
    register(select)

    expect(selectOptionInElement(0, 'B')).toMatchObject({ selected: 'B' })
    expect(select.value).toBe('b')
  })

  it('focuses a framed element when clicking it', () => {
    const inner = framedBody('<button>Go</button>')
    const button = visible(inner.querySelector('button') as HTMLButtonElement)
    register(button)
    let focused = false
    button.addEventListener('focus', () => {
      focused = true
    })

    expect(clickElement(0)).toMatchObject({ clicked: true })
    expect(focused).toBe(true)
  })

  it('still refuses a framed password field', () => {
    const inner = framedBody('<input type="password" />')
    register(inner.querySelector('input') as HTMLInputElement)

    expect(typeIntoElement(0, 'hunter2', false)).toEqual({ error: 'password' })
    expect(focusElementForTyping(0)).toEqual({ error: 'password' })
  })
})

describe('collectSnapshot', () => {
  it('labels a password field and never emits its value', () => {
    document.body.innerHTML = '<input type="password" value="hunter2" aria-label="Password" />'
    visible(document.querySelector('input') as HTMLInputElement)

    const outline = outlineOf(collectSnapshot())

    expect(outline).toContain('password-field')
    expect(outline).not.toContain('hunter2')
    expect(outline).not.toContain('value=')
  })

  it.each([
    ['a one-time code', 'one-time-code', '123456'],
    ['a card number', 'cc-number', '4111111111111111'],
    ['a card security code', 'cc-csc', '737'],
    ['a card expiry', 'cc-exp', '12/29'],
  ])('withholds the value of %s while still listing the field', (_label, token, value) => {
    document.body.innerHTML = `<input type="text" autocomplete="${token}" value="${value}" aria-label="Field" />`
    visible(document.querySelector('input') as HTMLInputElement)

    const outline = outlineOf(collectSnapshot())

    // Not reported as a password-field: the agent must still be able to fill
    // these, it just never learns what is already there.
    expect(outline).not.toContain('password-field')
    expect(outline).not.toContain(value)
    expect(outline).toContain('value-withheld')
  })

  it('withholds the value of a revealed password field', () => {
    document.body.innerHTML =
      '<input type="text" autocomplete="current-password" value="hunter2" aria-label="Password" />'
    visible(document.querySelector('input') as HTMLInputElement)

    const outline = outlineOf(collectSnapshot())

    expect(outline).toContain('password-field')
    expect(outline).not.toContain('hunter2')
  })

  it('still reports ordinary input values', () => {
    document.body.innerHTML = '<input type="text" value="tokyo" aria-label="City" />'
    visible(document.querySelector('input') as HTMLInputElement)

    expect(outlineOf(collectSnapshot())).toContain('value="tokyo"')
  })
})

describe('readActiveElementState', () => {
  it('withholds value, length, and selection size for a password field', () => {
    document.body.innerHTML = '<input type="password" value="hunter2" />'
    setActiveElement(document, document.querySelector('input'))

    expect(readActiveElementState()).toEqual({
      activeElement: 'password-field',
      selectedChars: 0,
      valueLength: 0,
      valuePreview: '',
      redacted: true,
    })
  })

  it('withholds the value of a revealed password field', () => {
    document.body.innerHTML =
      '<input type="text" autocomplete="current-password" value="hunter2" />'
    setActiveElement(document, document.querySelector('input'))

    expect(readActiveElementState()).toMatchObject({ redacted: true, valuePreview: '' })
  })

  it.each([
    ['a one-time code', 'one-time-code', '123456'],
    ['a card number', 'cc-number', '4111111111111111'],
    ['a card security code', 'cc-csc', '737'],
  ])('withholds %s on readback but still confirms the fill', (_label, token, value) => {
    document.body.innerHTML = `<input type="text" autocomplete="${token}" value="${value}" />`
    setActiveElement(document, document.querySelector('input'))

    // valueLength is kept: without it a successful type reads as "still empty"
    // and the agent types the code a second time.
    expect(readActiveElementState()).toEqual({
      activeElement: 'input',
      selectedChars: 0,
      valueLength: value.length,
      valuePreview: '',
      redacted: true,
    })
  })

  it('reports ordinary fields in full', () => {
    document.body.innerHTML = '<input type="text" value="tokyo" />'
    setActiveElement(document, document.querySelector('input'))

    expect(readActiveElementState()).toMatchObject({
      activeElement: 'input',
      valueLength: 5,
      valuePreview: 'tokyo',
    })
  })

  it('descends into a same-origin frame rather than reporting the frame', () => {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    const inner = frame.contentDocument as Document
    inner.body.innerHTML = '<input type="password" value="hunter2" />'
    setActiveElement(inner, inner.querySelector('input'))
    setActiveElement(document, frame)

    expect(readActiveElementState()).toMatchObject({
      activeElement: 'password-field',
      redacted: true,
    })
  })
})

describe('XHTML lower-case tagName', () => {
  /** An element whose tagName reads lower-case, as it does in an XHTML document. */
  function lowerCaseTagInput(html: string): HTMLInputElement {
    document.body.innerHTML = html
    const input = document.querySelector('input') as HTMLInputElement
    Object.defineProperty(input, 'tagName', { configurable: true, get: () => 'input' })
    return input
  }

  it('still refuses a password field whose tagName is lower-case', () => {
    const input = lowerCaseTagInput('<input type="password" />')
    register(visible(input))

    expect(typeIntoElement(0, 'hunter2', false)).toEqual({ error: 'password' })
    expect(input.value).toBe('')
  })

  it('still withholds the value of a lower-case-tagName credential field', () => {
    const input = lowerCaseTagInput(
      '<input type="password" value="hunter2" aria-label="Password" />'
    )
    visible(input)

    const outline = outlineOf(collectSnapshot())

    expect(outline).not.toContain('hunter2')
  })
})

describe('activeElementSecrecy', () => {
  it('reports safe for an ordinary field', () => {
    document.body.innerHTML = '<input type="text" />'
    setActiveElement(document, document.querySelector('input'))

    expect(activeElementSecrecy()).toBe('safe')
  })

  it('reports safe when nothing is focused', () => {
    setActiveElement(document, document.body)

    expect(activeElementSecrecy()).toBe('safe')
  })

  it('reports secret for a focused password field', () => {
    document.body.innerHTML = '<input type="password" />'
    setActiveElement(document, document.querySelector('input'))

    expect(activeElementSecrecy()).toBe('secret')
  })

  it('reports secret for a password field inside an open shadow root', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<input type="password" />'
    setActiveElement(shadow as unknown as Document, shadow.querySelector('input'))
    setActiveElement(document, host)

    expect(activeElementSecrecy()).toBe('secret')
  })

  it('reports opaque for a cross-origin frame it cannot inspect', () => {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    // A cross-origin frame yields null here; jsdom cannot host one, so the
    // boundary is reproduced directly.
    Object.defineProperty(frame, 'contentDocument', { configurable: true, get: () => null })
    setActiveElement(document, frame)

    expect(activeElementSecrecy()).toBe('opaque')
  })

  it('reports opaque for a password field inside a CLOSED shadow root', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const shadow = host.attachShadow({ mode: 'closed' })
    shadow.innerHTML = '<input type="password" />'
    // Focus inside a closed root retargets to the host and `shadowRoot` reads
    // null, which is exactly what the browser reports and what made this 'safe'.
    setActiveElement(document, host)

    expect(host.shadowRoot).toBeNull()
    expect(activeElementSecrecy()).toBe('opaque')
  })

  it('reports opaque for a closed shadow root on a custom element', () => {
    const host = document.createElement('my-login')
    document.body.append(host)
    host.attachShadow({ mode: 'closed' }).innerHTML = '<input autocomplete="new-password" />'
    setActiveElement(document, host)

    expect(activeElementSecrecy()).toBe('opaque')
  })

  it('still reports safe for a focused element that is focusable in its own right', () => {
    // The false-positive guard: a div the page made focusable is focused
    // itself, not hiding a shadow tree, so keystrokes are not refused.
    document.body.innerHTML = '<div tabindex="0">menu</div>'
    setActiveElement(document, document.querySelector('div'))

    expect(activeElementSecrecy()).toBe('safe')
  })

  it('still reports safe for a focused contenteditable', () => {
    document.body.innerHTML = '<div contenteditable="true">note</div>'
    const editable = document.querySelector('div') as HTMLElement
    Object.defineProperty(editable, 'isContentEditable', { get: () => true })
    setActiveElement(document, editable)

    expect(activeElementSecrecy()).toBe('safe')
  })

  it('descends into a same-origin frame instead of calling it opaque', () => {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    const inner = frame.contentDocument as Document
    inner.body.innerHTML = '<input type="text" />'
    setActiveElement(inner, inner.querySelector('input'))
    setActiveElement(document, frame)

    expect(activeElementSecrecy()).toBe('safe')
  })
})

describe('pressKeyOnPage', () => {
  it('refuses to deliver a keystroke to a focused password field', () => {
    document.body.innerHTML = '<input type="password" />'
    setActiveElement(document, document.querySelector('input'))

    expect(pressKeyOnPage('a', 'KeyA', 65, false, false, false, false)).toEqual({
      error: 'password',
    })
  })

  it('delivers keystrokes to ordinary fields', () => {
    document.body.innerHTML = '<input type="text" />'
    const input = document.querySelector('input') as HTMLInputElement
    setActiveElement(document, input)
    const seen: string[] = []
    input.addEventListener('keydown', (event) => seen.push(event.key))

    expect(pressKeyOnPage('a', 'KeyA', 65, false, false, false, false)).toMatchObject({
      pressed: 'a',
    })
    expect(seen).toEqual(['a'])
  })
})
