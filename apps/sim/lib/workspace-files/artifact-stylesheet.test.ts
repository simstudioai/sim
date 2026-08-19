/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
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
  it('scopes search to the page', () => {
    expect(SIM_ARTIFACT_SHELL).toContain('Filter sections')
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

  it('keeps the sidebar pill metrics from the docs sidebar', () => {
    expect(SIM_ARTIFACT_STYLESHEET).toContain('padding: 5px 0.5rem')
    expect(SIM_ARTIFACT_STYLESHEET).toContain('line-height: 20px')
  })

  // Inter leads the stack; each surface injects the matching @font-face.
  // Pages live inside the app: the PLATFORM stack, not the docs' webfont.
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
    expect(SIM_ARTIFACT_STYLESHEET).toContain('.rail a, .page-nav-card { font-weight: 400')
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
    expect(simTokenOverrides()).toBe('')
  })
})
