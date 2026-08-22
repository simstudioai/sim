/**
 * @vitest-environment node
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ARTIFACT_TOKENS,
  SIM_ARTIFACT_SHELL,
  SIM_ARTIFACT_STYLESHEET,
  simTokenOverrides,
  usesSimArtifactStyles,
} from '@/lib/workspace-files/artifact-stylesheet'
import { buildHtmlPreviewDocument } from '@/app/workspace/[workspaceId]/files/components/file-viewer/preview-panel'

const MARKED =
  '<!DOCTYPE html><html><head><meta name="sim-artifact"><title>T</title></head><body><div class="page"></div></body></html>'
const PLAIN = '<!DOCTYPE html><html><head><title>T</title></head><body><p>hi</p></body></html>'

describe('usesSimArtifactStyles', () => {
  it('detects the opt-in marker regardless of quoting and attribute order', () => {
    expect(usesSimArtifactStyles(MARKED)).toBe(true)
    expect(usesSimArtifactStyles("<meta content='x' name='sim-artifact'>")).toBe(true)
  })

  it('leaves a page that never asked for it alone', () => {
    expect(usesSimArtifactStyles(PLAIN)).toBe(false)
  })
})

describe('buildHtmlPreviewDocument', () => {
  it('injects the stylesheet only for a page that opted in', () => {
    expect(buildHtmlPreviewDocument(MARKED)).toContain('--surface-active')
    expect(buildHtmlPreviewDocument(PLAIN)).not.toContain('--surface-active')
  })

  // The page keys off [data-theme]; prefers-color-scheme inside an opaque-origin
  // frame follows the OS, so without this the page and the app disagree.
  it('stamps the app theme onto the document root', () => {
    expect(buildHtmlPreviewDocument(PLAIN, 'dark')).toContain('<html data-theme="dark">')
    expect(buildHtmlPreviewDocument(PLAIN, 'light')).toContain('<html data-theme="light">')
  })

  it('preserves attributes the page already set on <html>', () => {
    const withLang = buildHtmlPreviewDocument(
      '<html lang="en"><head></head><body></body></html>',
      'dark'
    )
    expect(withLang).toContain('data-theme="dark"')
    expect(withLang).toContain('lang="en"')
  })

  it('never overrides a theme the page pinned itself', () => {
    const pinned = buildHtmlPreviewDocument(
      '<html data-theme="light"><head></head><body></body></html>',
      'dark'
    )
    expect(pinned).toContain('data-theme="light"')
    expect(pinned).not.toContain('data-theme="dark"')
  })

  it('keeps the sandbox guarantees on every path', () => {
    for (const doc of [MARKED, PLAIN, '<p>bare fragment</p>']) {
      const built = buildHtmlPreviewDocument(doc)
      expect(built).toContain("default-src 'none'")
      expect(built).toContain('about:srcdoc')
    }
  })

  // A page file streams in as source; until the frontmatter closes it cannot
  // compile, and a reader must never see raw source in its place.
  it('holds the empty themed shell for page source that does not compile yet', () => {
    const partial = '---\ntitle: Elder Guide\nlede: Still stre'
    const built = buildHtmlPreviewDocument(partial)
    expect(built).not.toContain('Still stre')
    expect(built).toContain('--surface-active')
  })

  it('still shows a bespoke raw-HTML document as-is', () => {
    expect(buildHtmlPreviewDocument(PLAIN)).toContain('<p>hi</p>')
  })

  // The stylesheet is a floor, not a ceiling: a page that wants its own design
  // still wins, so it must land before the page's own <style>.
  it('injects the stylesheet ahead of the page styles', () => {
    const built = buildHtmlPreviewDocument(
      '<html><head><meta name="sim-artifact"><style>body{color:red}</style></head><body></body></html>'
    )
    expect(built.indexOf('--surface-active')).toBeLessThan(built.indexOf('body{color:red}'))
  })
})

describe('docs shell', () => {
  it('ships the heading-derived chrome only to pages that opted in', () => {
    expect(buildHtmlPreviewDocument(MARKED)).toContain('art-cols')
    expect(buildHtmlPreviewDocument(PLAIN)).not.toContain('art-cols')
  })

  // Rails and search are generated from the document's own headings, so a page
  // never hand-writes nav that can fall out of step with them.
  it('derives both rails from headings rather than authored markup', () => {
    expect(SIM_ARTIFACT_SHELL).toContain("querySelectorAll('h2, h3')")
    expect(SIM_ARTIFACT_SHELL).toContain('On this page')
  })

  it('does nothing to a page that did not ask for the docs layout', () => {
    expect(SIM_ARTIFACT_SHELL).toContain('.page[data-layout="docs"]')
  })

  // The sandbox blocks the network; a box implying it searched the workspace
  // would be lying about what it does.
  it('has no left sidebar or filter chrome', () => {
    expect(SIM_ARTIFACT_SHELL).not.toContain('Filter sections')
    expect(SIM_ARTIFACT_SHELL).not.toContain("dataset.rail = 'nav'")
  })

  // The clerk TOC: a track threaded through the items and a full-strength copy
  // clipped to the active range — the clip window is what animates on scroll.
  it('draws the clerk track and animates the active segment via the clip window', () => {
    expect(SIM_ARTIFACT_SHELL).toContain('toc-track')
    expect(SIM_ARTIFACT_SHELL).toContain('--track-top')
    expect(SIM_ARTIFACT_SHELL).toContain('--track-bottom')
    expect(SIM_ARTIFACT_STYLESHEET).toContain('clip-path: polygon(0 var(--track-top')
    expect(SIM_ARTIFACT_STYLESHEET).toContain('transition: clip-path')
  })

  // fumadocs clerk geometry: h2 lines at 8px, h3 at 16px, items indented 20/32.
  it('indents TOC items and track lines by heading depth', () => {
    expect(SIM_ARTIFACT_SHELL).toContain("depth === '2' ? 8 : 16")
    expect(SIM_ARTIFACT_STYLESHEET).toContain(
      '.toc-items a[data-depth="2"] { padding-left: 20px; }'
    )
    expect(SIM_ARTIFACT_STYLESHEET).toContain(
      '.toc-items a[data-depth="3"] { padding-left: 32px; }'
    )
  })
})

describe('docs fidelity', () => {
  it('keeps every grid template at equal specificity so wider tiers win', () => {
    // The 560px tier selects .art-cols:not(.no-side-nav) (0,2,0); a wider
    // tier written as bare .art-cols (0,1,0) loses despite its media query,
    // leaving the 2-column template active and wrapping the TOC to the next
    // grid row. Every template rule must carry the same specificity.
    const templates = SIM_ARTIFACT_STYLESHEET.split('\n').filter((line) =>
      line.includes('grid-template-columns:')
    )
    expect(templates.length).toBeGreaterThanOrEqual(2)
    for (const line of templates) {
      const selector = (line.trim().split('{')[0] ?? '').trim()
      if (!selector.startsWith('.art-cols')) continue
      // Every template rule uses the same bare selector, so the widest
      // media query always wins the cascade.
      expect(selector).toBe('.art-cols')
    }
  })

  // The docs table treatment: header rule on --border, row rules on
  // --surface-active, no outer chrome.
  it('styles tables as the docs divider tables', () => {
    expect(SIM_ARTIFACT_STYLESHEET).toContain(
      'thead th { font-weight: 600; color: var(--text-primary); border-bottom: 1px solid var(--border)'
    )
    expect(SIM_ARTIFACT_STYLESHEET).toContain('border-bottom: 1px solid var(--surface-active)')
  })

  // The card/stat vocabulary is retired — a figure worth stating is a sentence
  // or a table row, and legacy pages fall back to plain prose.
  it('carries no card or stat chrome', () => {
    expect(SIM_ARTIFACT_STYLESHEET).not.toContain('.card')
    expect(SIM_ARTIFACT_STYLESHEET).not.toContain('.stat')
    expect(SIM_ARTIFACT_STYLESHEET).not.toContain('.grid')
  })

  // The sidebar left the shell; nothing should keep its pill styles alive.
  it('carries no sidebar rail styles', () => {
    expect(SIM_ARTIFACT_STYLESHEET).not.toContain('data-rail="nav"')
  })

  // Set navigation is the docs' top tab row. A long set must scroll
  // sideways — never wrap or truncate — with no scrollbar chrome; and the
  // retired prev/next arrows must stay gone.
  it('keeps the tab row one scrollable line and carries no arrow chrome', () => {
    expect(SIM_ARTIFACT_STYLESHEET).toContain('overflow-x: auto; scrollbar-width: none;')
    expect(SIM_ARTIFACT_STYLESHEET).toContain('.page-tabs::-webkit-scrollbar { display: none; }')
    expect(SIM_ARTIFACT_STYLESHEET).toContain('.page-tab.is-active')
    expect(SIM_ARTIFACT_STYLESHEET).not.toContain('.page-nav')
    expect(SIM_ARTIFACT_STYLESHEET).not.toContain('.pa-nav')
    expect(SIM_ARTIFACT_SHELL).not.toContain('page-actions')
  })

  // Pages live inside the app: the PLATFORM stack, not the docs' webfont —
  // Inter next to emcn/sim chrome read as foreign.
  it('uses the platform font stack', () => {
    expect(SIM_ARTIFACT_STYLESHEET).toContain('--font-sans: ui-sans-serif, -apple-system')
    expect(SIM_ARTIFACT_STYLESHEET).not.toContain('"Inter"')
  })

  // The docs' prose anchor: 500 weight, 1.5px underline offset 3.5px, hover
  // fades to 80% — with chrome links reset back to plain navigation.
  it('styles content links as the docs prose anchors', () => {
    expect(SIM_ARTIFACT_STYLESHEET).toContain('text-decoration-thickness: 1.5px')
    expect(SIM_ARTIFACT_STYLESHEET).toContain('text-underline-offset: 3.5px')
    expect(SIM_ARTIFACT_STYLESHEET).toContain('a:hover { opacity: 0.8; }')
    expect(SIM_ARTIFACT_STYLESHEET).toContain('.rail a { font-weight: 400')
  })

  // The docs' figure.shiki shell and Code.Viewer metrics.
  it('frames fenced code like the docs', () => {
    expect(SIM_ARTIFACT_STYLESHEET).toContain('background: var(--code-surface)')
    expect(SIM_ARTIFACT_STYLESHEET).toContain('line-height: 21px')
    expect(SIM_ARTIFACT_STYLESHEET).toContain(
      '.codeblock-copy.is-copied { color: var(--brand-accent); }'
    )
    expect(SIM_ARTIFACT_SHELL).toContain('M14.25 0.75H2.75') // emcn Duplicate
    expect(SIM_ARTIFACT_SHELL).toContain('M18.25 2.75L7.25 15.75') // emcn Check
  })

  // The docs' inline chip: no border, color unset so linked code keeps the
  // link color.
  it('keeps the inline code chip borderless and color-neutral', () => {
    expect(SIM_ARTIFACT_STYLESHEET).toContain('padding: 0.125rem 0.375rem')
    expect(SIM_ARTIFACT_STYLESHEET).not.toContain(
      'code {\n  font-family: var(--font-mono);\n  font-size: 0.84em'
    )
  })

  it('carries the platform selection color', () => {
    expect(SIM_ARTIFACT_STYLESHEET).toContain(
      '::selection { background-color: var(--selection-bg); }'
    )
  })
})

describe('simTokenOverrides', () => {
  it('emits nothing off the browser, leaving the sheet fallbacks in place', () => {
    expect(simTokenOverrides('light')).toBe('')
  })
})

/** Extracts the body of the first block whose opening selector matches. */
function cssBlock(css: string, start: RegExp): string {
  const match = start.exec(css)
  if (!match) throw new Error(`selector not found: ${start}`)
  const open = css.indexOf('{', match.index) + 1
  let depth = 1
  let end = open
  while (depth > 0) {
    const ch = css[end]
    if (ch === '{') depth += 1
    if (ch === '}') depth -= 1
    end += 1
  }
  return css.slice(open, end - 1)
}

/** First declaration per token, comments stripped, whitespace normalized. */
function tokenMap(block: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const decl of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const value = decl[2]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    if (!map.has(decl[1])) map.set(decl[1], value)
  }
  return map
}

// The sheet's token values are MIRRORS of globals.css — the surfaces the live
// overrides cannot reach (downloaded/shared/standalone documents, and the
// theme the app is not currently in) render from them. A silent retune of
// globals.css is invisible until a shared page looks off-brand; this makes it
// a named test failure instead.
describe('token mirrors stay in sync with globals.css', () => {
  const globals = readFileSync(join(process.cwd(), 'app/_styles/globals.css'), 'utf8')
  const appLight = tokenMap(cssBlock(globals, /:root,\s*\n\s*\.light\s*\{/))
  const appDark = tokenMap(cssBlock(globals, /\n {2}\.dark\s*\{/))
  const sheetLight = tokenMap(cssBlock(SIM_ARTIFACT_STYLESHEET, /^:root \{/))
  const sheetMediaDark = tokenMap(
    cssBlock(SIM_ARTIFACT_STYLESHEET, /:root:not\(\[data-theme="light"\]\)\s*\{/)
  )
  const sheetAttrDark = tokenMap(
    cssBlock(SIM_ARTIFACT_STYLESHEET, /:root\[data-theme="dark"\]\s*\{/)
  )

  it('mirrors every consumed token in both themes', () => {
    const drift: string[] = []
    for (const token of ARTIFACT_TOKENS) {
      const appLightValue = appLight.get(token)
      const appDarkValue = appDark.get(token)
      if (!appLightValue || !appDarkValue) {
        drift.push(
          `${token}: not defined in globals.css (light=${appLightValue}, dark=${appDarkValue})`
        )
        continue
      }
      if (sheetLight.get(token) !== appLightValue) {
        drift.push(`${token} light: sheet=${sheetLight.get(token)} app=${appLightValue}`)
      }
      if (sheetMediaDark.get(token) !== appDarkValue) {
        drift.push(`${token} dark(media): sheet=${sheetMediaDark.get(token)} app=${appDarkValue}`)
      }
      if (sheetAttrDark.get(token) !== appDarkValue) {
        drift.push(`${token} dark(stamp): sheet=${sheetAttrDark.get(token)} app=${appDarkValue}`)
      }
    }
    expect(drift).toEqual([])
  })
})
