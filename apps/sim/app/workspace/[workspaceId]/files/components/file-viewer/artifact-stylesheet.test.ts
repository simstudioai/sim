/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  SIM_ARTIFACT_SHELL,
  simTokenOverrides,
  usesSimArtifactStyles,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/artifact-stylesheet'
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
})

describe('simTokenOverrides', () => {
  it('emits nothing off the browser, leaving the sheet fallbacks in place', () => {
    expect(simTokenOverrides()).toBe('')
  })
})
