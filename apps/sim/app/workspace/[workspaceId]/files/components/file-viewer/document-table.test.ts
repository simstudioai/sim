/**
 * @vitest-environment jsdom
 *
 * A table must look the same whichever file it came from: a markdown file rendered by the rich
 * markdown editor (`.rich-markdown-prose table`) and a CSV/XLSX preview rendered by `DataTable`
 * (`.document-table`) sit in the same file viewer, in the same session, one click apart. They used
 * to drift — the previews carried their own chrome (rounded outer frame, `--surface-2` header,
 * 13px body / 12px header, `--text-secondary` cells) while markdown tables used full cell borders
 * on `--border`, a `--surface-4` header, and 14px text.
 *
 * These load the real, shipped CSS (not a copy). Two complementary assertions, because jsdom's CSS
 * engine resolves only part of what matters here: it applies the cascade for longhand declarations
 * (so `getComputedStyle` parity is a real check on padding/typography/fill), but it does not expand
 * the `border` shorthand at all. Borders are therefore checked structurally — one rule, whose
 * selector list covers both roots — which is also the property that actually prevents drift.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

const SHARED_CSS_PATH = path.join(__dirname, 'document-table.css')
const EDITOR_CSS_PATH = path.join(__dirname, 'rich-markdown-editor', 'rich-markdown-editor.css')

/** Chrome both surfaces must agree on, as longhands jsdom resolves. */
const SHARED_CELL_PROPS = [
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'font-size',
  'line-height',
  'text-align',
  'vertical-align',
] as const

const sheets = new Map<string, CSSStyleSheet>()

beforeAll(() => {
  for (const file of [SHARED_CSS_PATH, EDITOR_CSS_PATH]) {
    const style = document.createElement('style')
    style.textContent = readFileSync(file, 'utf-8')
    document.head.appendChild(style)
    if (!style.sheet) throw new Error(`stylesheet did not parse: ${file}`)
    sheets.set(file, style.sheet)
  }
})

let containers: HTMLDivElement[] = []

afterEach(() => {
  for (const c of containers) c.remove()
  containers = []
})

/** Mounts a one-cell table inside `rootClass` and returns the root plus its `th` and `td`. */
function mountTable(rootClass: string): { root: HTMLElement; th: HTMLElement; td: HTMLElement } {
  const container = document.createElement('div')
  container.className = rootClass
  container.innerHTML =
    '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table>'
  document.body.appendChild(container)
  containers.push(container)
  const th = container.querySelector('th')
  const td = container.querySelector('td')
  if (!th || !td) throw new Error('table cells not found')
  return { root: container, th, td }
}

function declarations(el: Element, props: readonly string[]): Record<string, string> {
  const computed = getComputedStyle(el)
  return Object.fromEntries(props.map((p) => [p, computed.getPropertyValue(p)]))
}

/** Style rules of one loaded stylesheet, in source order. */
function styleRules(cssPath: string): CSSStyleRule[] {
  const sheet = sheets.get(cssPath)
  if (!sheet) throw new Error(`stylesheet not loaded: ${cssPath}`)
  return Array.from(sheet.cssRules).filter((r): r is CSSStyleRule => r instanceof CSSStyleRule)
}

/** Selector list of the single shared rule declaring `property: value`, as trimmed selectors. */
function selectorsDeclaring(cssPath: string, property: string, value: string): string[] {
  const matching = styleRules(cssPath).filter((r) =>
    r.style.getPropertyValue(property).includes(value)
  )
  expect(matching).toHaveLength(1)
  return matching[0].selectorText.split(',').map((s) => s.trim())
}

describe('document-table chrome is shared with markdown tables', () => {
  it('cells resolve to identical padding and typography', () => {
    const prose = mountTable('rich-markdown-prose')
    const preview = mountTable('document-table')

    expect(declarations(preview.td, SHARED_CELL_PROPS)).toEqual(
      declarations(prose.td, SHARED_CELL_PROPS)
    )
    expect(declarations(preview.th, SHARED_CELL_PROPS)).toEqual(
      declarations(prose.th, SHARED_CELL_PROPS)
    )
  })

  /**
   * Cells hold arbitrary file data, so an unbreakable token (a URL, a hash) must break rather than
   * overflow — the previews lost `whitespace-nowrap` and would otherwise have no wrapping rule at
   * all. `overflow-wrap` is inherited from each surface's root (jsdom does not propagate inherited
   * properties to descendants, so the roots are what can be asserted).
   */
  it('both roots declare the same wrapping for unbreakable cell values', () => {
    const prose = mountTable('rich-markdown-prose')
    const preview = mountTable('document-table')

    const wrap = getComputedStyle(prose.root).getPropertyValue('overflow-wrap')
    expect(wrap).toBe('anywhere')
    expect(getComputedStyle(preview.root).getPropertyValue('overflow-wrap')).toBe(wrap)
  })

  it('the preview table sizes to its content while the prose table fits the frame', () => {
    const prose = mountTable('rich-markdown-prose')
    const preview = mountTable('document-table')

    const proseTable = prose.root.querySelector('table')
    const previewTable = preview.root.querySelector('table')
    if (!proseTable || !previewTable) throw new Error('tables not found')

    expect(getComputedStyle(proseTable).getPropertyValue('width')).toBe('100%')
    expect(getComputedStyle(previewTable).getPropertyValue('width')).toBe('max-content')
    expect(getComputedStyle(previewTable).getPropertyValue('min-width')).toBe('100%')
  })

  it('a preview column is bounded so no value collapses or monopolises the row', () => {
    const { th, td } = mountTable('document-table')

    for (const cell of [th, td]) {
      expect(getComputedStyle(cell).getPropertyValue('min-width')).toBe('80px')
      expect(getComputedStyle(cell).getPropertyValue('max-width')).toBe('320px')
    }
  })

  it('the resolved values are the markdown editor values, not jsdom defaults', () => {
    const { th, td } = mountTable('document-table')

    expect(getComputedStyle(td).getPropertyValue('padding-left')).toBe('0.75rem')
    expect(getComputedStyle(td).getPropertyValue('font-size')).toBe('14px')
    expect(getComputedStyle(th).getPropertyValue('font-weight')).toBe('600')
  })

  it('one rule draws the cell border for both roots', () => {
    expect(
      selectorsDeclaring(SHARED_CSS_PATH, 'border', 'var(--border-width) solid var(--border)')
    ).toEqual(
      expect.arrayContaining([
        '.rich-markdown-prose th',
        '.rich-markdown-prose td',
        '.document-table th',
        '.document-table td',
      ])
    )
  })

  it('one rule fills the header for both roots', () => {
    expect(selectorsDeclaring(SHARED_CSS_PATH, 'background', 'var(--surface-4)')).toEqual(
      expect.arrayContaining(['.rich-markdown-prose th', '.document-table th'])
    )
  })

  it('the editor stylesheet no longer re-declares cell chrome of its own', () => {
    const redeclared = styleRules(EDITOR_CSS_PATH).filter(
      (r) =>
        /\.rich-markdown-prose (th|td)\b/.test(r.selectorText) &&
        (r.style.getPropertyValue('border') ||
          r.style.getPropertyValue('padding') ||
          r.style.getPropertyValue('font-size') ||
          r.style.getPropertyValue('background'))
    )

    expect(redeclared.map((r) => r.selectorText)).toEqual([])
  })
})
