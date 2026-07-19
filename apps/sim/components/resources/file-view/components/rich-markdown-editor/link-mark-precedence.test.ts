/**
 * @vitest-environment jsdom
 *
 * A mark stacked on top of another color-setting context must not steal that context's color: an
 * element's own explicit `color` rule always wins over an inherited value, regardless of how specific
 * the ancestor's selector is. Two contexts hit this in practice:
 *
 * - A link's blue, stacked with bold/italic/strikethrough/inline-code. `strong`/`em`/`code` no longer
 *   set their own `color` at all (it was redundant with the prose default anyway, and — like the
 *   `mark`/highlight rule's own `color: inherit` — the absence of a rule is what lets inheritance
 *   carry through correctly from ANY ambient context, not just links). `del`/`s` genuinely need their
 *   own dimmer default, so they keep an explicit `color` plus an override for the link case.
 * - `h6`'s intentionally dimmer `--text-secondary` (vs. every other heading and the prose default,
 *   both `--text-primary`), stacked with bold/italic — before strong/em's color was removed, a bold
 *   run inside an `h6` incorrectly showed the brighter `--text-primary` instead of `h6`'s own tone.
 *
 * These load the real, shipped `rich-markdown-editor.css` (not a copy) and assert against
 * `getComputedStyle` in jsdom. jsdom's CSS engine does not resolve `var(...)` references to actual
 * color values, but it does correctly resolve the cascade/specificity/inheritance winner and returns
 * that declaration's authored value verbatim — so asserting the winning value is `var(--brand-secondary)`
 * (vs. e.g. `var(--text-primary)`) is a precise, real assertion about which CSS rule wins, not a proxy.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

const CSS_PATH = path.join(__dirname, 'rich-markdown-editor.css')
const LINK_COLOR = 'var(--brand-secondary)'

beforeAll(() => {
  const style = document.createElement('style')
  style.textContent = readFileSync(CSS_PATH, 'utf-8')
  document.head.appendChild(style)
})

let container: HTMLDivElement | null = null

afterEach(() => {
  container?.remove()
  container = null
})

/** Mounts `html` inside a `.rich-markdown-prose` container (the real editor's root class) and returns it. */
function mount(html: string): HTMLDivElement {
  container = document.createElement('div')
  container.className = 'rich-markdown-prose'
  container.innerHTML = html
  document.body.appendChild(container)
  return container
}

function colorOf(el: Element | null): string {
  if (!el) throw new Error('element not found')
  return getComputedStyle(el).color
}

describe('link color baseline (no stacked mark)', () => {
  it('a plain link is brand-secondary colored', () => {
    const root = mount('<a href="#">link</a>')
    expect(colorOf(root.querySelector('a'))).toBe(LINK_COLOR)
  })
})

describe('a mark with no link keeps its own color (regression guard: the fix must not force every mark blue)', () => {
  it.each([
    { tag: 'strong', html: '<strong>bold</strong>', color: 'var(--text-primary)' },
    { tag: 'em', html: '<em>italic</em>', color: 'var(--text-primary)' },
    { tag: 'del', html: '<del>struck</del>', color: 'var(--text-tertiary)' },
    { tag: 's', html: '<s>struck</s>', color: 'var(--text-tertiary)' },
    { tag: 'code', html: '<code>code</code>', color: 'var(--text-primary)' },
  ])('$tag alone renders $color, not link color', ({ tag, html, color }) => {
    const root = mount(html)
    expect(colorOf(root.querySelector(tag))).toBe(color)
    expect(colorOf(root.querySelector(tag))).not.toBe(LINK_COLOR)
  })
})

describe('mark nested INSIDE a link (`<a><mark>text</mark></a>`) — link color wins', () => {
  it.each([
    { tag: 'strong', html: '<a href="#"><strong>bold link</strong></a>' },
    { tag: 'em', html: '<a href="#"><em>italic link</em></a>' },
    { tag: 'del', html: '<a href="#"><del>struck link</del></a>' },
    { tag: 's', html: '<a href="#"><s>struck link</s></a>' },
    { tag: 'code', html: '<a href="#"><code>code link</code></a>' },
  ])('$tag inside a link is link-colored, not its own default color', ({ tag, html }) => {
    const root = mount(html)
    expect(colorOf(root.querySelector(tag))).toBe(LINK_COLOR)
  })
})

describe('mark WRAPPING a link (`<mark><a>text</a></mark>`) — link color still wins', () => {
  it.each([
    { tag: 'strong', html: '<strong><a href="#">bold link</a></strong>' },
    { tag: 'em', html: '<em><a href="#">italic link</a></em>' },
    { tag: 'del', html: '<del><a href="#">struck link</a></del>' },
    { tag: 's', html: '<s><a href="#">struck link</a></s>' },
    { tag: 'code', html: '<code><a href="#">code link</a></code>' },
  ])('a link inside $tag is link-colored regardless of nesting direction', ({ tag, html }) => {
    const root = mount(html)
    expect(colorOf(root.querySelector('a'))).toBe(LINK_COLOR)
  })
})

describe('each mark keeps its own non-color styling even when link-colored', () => {
  it('bold link keeps font-weight 600', () => {
    const root = mount('<a href="#"><strong>bold link</strong></a>')
    const strong = root.querySelector('strong') as HTMLElement
    expect(colorOf(strong)).toBe(LINK_COLOR)
    expect(getComputedStyle(strong).fontWeight).toBe('600')
  })

  it('italic link keeps font-style italic', () => {
    const root = mount('<a href="#"><em>italic link</em></a>')
    const em = root.querySelector('em') as HTMLElement
    expect(colorOf(em)).toBe(LINK_COLOR)
    expect(getComputedStyle(em).fontStyle).toBe('italic')
  })

  it('strikethrough link keeps text-decoration line-through (del and s)', () => {
    for (const tag of ['del', 's']) {
      const root = mount(`<a href="#"><${tag}>struck link</${tag}></a>`)
      const el = root.querySelector(tag) as HTMLElement
      expect(colorOf(el)).toBe(LINK_COLOR)
      expect(getComputedStyle(el).textDecoration).toContain('line-through')
      container?.remove()
    }
  })

  it('inline-code link keeps its monospace font and background', () => {
    const root = mount('<a href="#"><code>code link</code></a>')
    const code = root.querySelector('code') as HTMLElement
    const computed = getComputedStyle(code)
    expect(colorOf(code)).toBe(LINK_COLOR)
    expect(computed.fontFamily).toContain('mono')
    expect(computed.background).toContain('var(--surface-5)')
  })
})

describe('multiple marks stacked together with a link', () => {
  it('bold + italic + link: link color wins, both font-weight and font-style are preserved', () => {
    const root = mount('<a href="#"><strong><em>bold italic link</em></strong></a>')
    const em = root.querySelector('em') as HTMLElement
    const strong = root.querySelector('strong') as HTMLElement
    expect(colorOf(em)).toBe(LINK_COLOR)
    expect(colorOf(strong)).toBe(LINK_COLOR)
    expect(getComputedStyle(em).fontStyle).toBe('italic')
    expect(getComputedStyle(strong).fontWeight).toBe('600')
  })

  it('bold + italic + strikethrough + link: link color wins at every nesting level', () => {
    const root = mount(
      '<a href="#"><strong><em><del>bold italic struck link</del></em></strong></a>'
    )
    for (const tag of ['strong', 'em', 'del']) {
      expect(colorOf(root.querySelector(tag))).toBe(LINK_COLOR)
    }
  })

  it('a mark stack with NO link present is unaffected by the link-precedence rule', () => {
    const root = mount('<strong><em>bold italic, no link</em></strong>')
    expect(colorOf(root.querySelector('em'))).toBe('var(--text-primary)')
    expect(colorOf(root.querySelector('strong'))).toBe('var(--text-primary)')
  })
})

describe('a link elsewhere in the document does not bleed color into unrelated marks', () => {
  it('a sibling bold run outside any link keeps its own color', () => {
    const root = mount('<p><a href="#">a link</a> and <strong>bold text</strong></p>')
    expect(colorOf(root.querySelector('a'))).toBe(LINK_COLOR)
    expect(colorOf(root.querySelector('strong'))).toBe('var(--text-primary)')
  })
})

describe('headings stack correctly with marks (same bug class, a different ambient color)', () => {
  it.each(['h1', 'h2', 'h3', 'h4', 'h5'])(
    '%s carries --text-primary, same as bold/italic inside it — no visible regression either way',
    (tag) => {
      const root = mount(`<${tag}><strong>bold</strong> <em>italic</em></${tag}>`)
      expect(colorOf(root.querySelector(tag))).toBe('var(--text-primary)')
      expect(colorOf(root.querySelector('strong'))).toBe('var(--text-primary)')
      expect(colorOf(root.querySelector('em'))).toBe('var(--text-primary)')
    }
  )

  // h6 is the one heading with its own dimmer tone (--text-secondary, not --text-primary like every
  // other heading and the prose default) — the exact shape of ambient color strong/em must inherit
  // rather than reset, the same failure mode as the link case above just triggered by a heading
  // instead of an <a>.
  it('h6 keeps its dimmer --text-secondary, and bold/italic inside it inherit that tone (not --text-primary)', () => {
    const root = mount('<h6><strong>bold</strong> <em>italic</em> plain</h6>')
    const h6 = root.querySelector('h6') as HTMLElement
    expect(colorOf(h6)).toBe('var(--text-secondary)')
    expect(colorOf(root.querySelector('strong'))).toBe('var(--text-secondary)')
    expect(colorOf(root.querySelector('em'))).toBe('var(--text-secondary)')
  })

  it('inline code inside h6 also inherits --text-secondary, not its own hardcoded default', () => {
    const root = mount('<h6><code>code</code></h6>')
    expect(colorOf(root.querySelector('code'))).toBe('var(--text-secondary)')
  })

  it('a struck-through run inside h6 keeps its own dimmer tertiary tone (mark-own-color still wins over a non-link ambient context)', () => {
    const root = mount('<h6><del>struck</del></h6>')
    expect(colorOf(root.querySelector('del'))).toBe('var(--text-tertiary)')
  })

  it('an anchor heading (link wrapping the whole heading) still shows link color, unaffected by h6', () => {
    const root = mount('<h6><a href="#">linked heading</a></h6>')
    expect(colorOf(root.querySelector('a'))).toBe(LINK_COLOR)
  })

  it('bold + italic + link inside h6: link color wins over both the mark defaults and h6 itself', () => {
    const root = mount('<h6><a href="#"><strong><em>bold italic link</em></strong></a></h6>')
    expect(colorOf(root.querySelector('em'))).toBe(LINK_COLOR)
    expect(colorOf(root.querySelector('strong'))).toBe(LINK_COLOR)
  })
})
