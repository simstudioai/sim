/**
 * @vitest-environment jsdom
 *
 * The editor's node chrome must be reachable from every surface, including a bare one.
 *
 * `.rich-markdown-prose` is the document type scale and ink, and a host that paints its own surface
 * (the canvas Note card) drops it — so a chrome rule authored under that class silently vanishes
 * there. That is how a note's checklists shipped rendering as a native checkbox beside a disc
 * bullet, with the label wrapped onto the next line: every `ul[data-type="taskList"]` rule lived on
 * the prose class, and the generic `ul` styling was all that was left.
 *
 * Reads the real, shipped stylesheet rather than a copy.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const EDITOR_CSS_PATH = path.join(__dirname, 'rich-markdown-editor.css')

/**
 * Selector fragments that identify a ProseMirror node or interaction the editor owns and no host
 * re-declares — as opposed to typography, which a bare host supplies itself.
 */
const CHROME_MARKERS = [
  'taskList',
  'ProseMirror-selectednode',
  'ProseMirror-gapcursor',
  'rich-leaf-in-selection',
  'column-resize-handle',
  'selectedCell',
  'code-editor-theme',
  'raw-markdown-',
] as const

let selectors: string[] = []
let style: HTMLStyleElement

beforeAll(() => {
  style = document.createElement('style')
  style.textContent = readFileSync(EDITOR_CSS_PATH, 'utf-8')
  document.head.appendChild(style)
  if (!style.sheet) throw new Error('rich-markdown-editor.css did not parse')
  selectors = Array.from(style.sheet.cssRules)
    .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
    .map((rule) => rule.selectorText)
})

afterAll(() => style.remove())

describe('rich markdown chrome scoping', () => {
  it.each(CHROME_MARKERS)('scopes every %s rule to the shared node class', (marker) => {
    const matching = selectors.filter((selector) => selector.includes(marker))
    expect(matching.length).toBeGreaterThan(0)
    for (const selector of matching) {
      expect(selector).toContain('.rich-markdown-nodes')
      expect(selector).not.toContain('.rich-markdown-prose')
    }
  })

  it.each(['div', 'span'].flatMap((tag) => [false, true].map((linked) => ({ tag, linked }))))(
    'keeps the $tag image selection ring inside the image (linked: $linked)',
    ({ tag, linked }) => {
      const root = document.createElement('div')
      root.className = 'rich-markdown-nodes'
      const wrapper = document.createElement(tag)
      wrapper.className = 'ProseMirror-selectednode'
      const image = document.createElement('img')
      if (linked) {
        const link = document.createElement('a')
        link.append(image)
        wrapper.append(link)
      } else wrapper.append(image)
      root.append(wrapper)
      document.body.append(root)
      try {
        expect(getComputedStyle(image).outlineOffset).toBe('-2px')
        expect(getComputedStyle(wrapper).outline).toBe('none')
        wrapper.classList.remove('ProseMirror-selectednode')
        expect(getComputedStyle(image).outlineOffset).toBe('')
      } finally {
        root.remove()
      }
    }
  )
})
