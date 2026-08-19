/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  collectSimPageDiagnostics,
  compileSimPage,
  isHandWrittenCompiledPage,
  isSimPageSource,
  SIM_PAGE_MARKER,
} from '@/lib/workspace-files/page-compile'

const SOURCE = `---
title: Workspace Overview
eyebrow: Snapshot · 18 August 2026
lede: A concise inventory.
---

## Summary

An experimentation workspace, **not** a production estate.

\`\`\`sim:table
columns: [Name, Status, "Blocks:num"]
rows:
  - [default-agent, Draft, 2]
  - [forceful-arm, Deployed, 4]
\`\`\`
`

describe('isSimPageSource', () => {
  it('recognises source by its titled frontmatter', () => {
    expect(isSimPageSource(SOURCE)).toBe(true)
  })

  // Raw HTML is the bespoke escape hatch and must render as-is everywhere.
  it('is false for bespoke raw HTML', () => {
    expect(isSimPageSource('<!DOCTYPE html><html><body>custom</body></html>')).toBe(false)
  })

  // Files stored by the retired write-time compiler stay renderable as-is.
  it('is false for legacy stored-compiled pages', () => {
    expect(isSimPageSource(`<!DOCTYPE html>\n${SIM_PAGE_MARKER}\n<h1>x</h1>`)).toBe(false)
  })

  it('is false for plain markdown without frontmatter', () => {
    expect(isSimPageSource('# Title\n\nBody.')).toBe(false)
  })
})

describe('compileSimPage', () => {
  it('emits a complete document from frontmatter, closers included', () => {
    const html = compileSimPage(SOURCE)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<meta name="sim-artifact">')
    expect(html).toContain('<title>Workspace Overview</title>')
    expect(html).toContain('<div class="page" data-layout="docs">')
    expect(html).toContain('<h1>Workspace Overview</h1>')
    expect(html).toContain('<p class="lede">A concise inventory.</p>')
    expect(html).toContain('</body>')
    expect(html).toContain('</html>')
    // The write-time compiler's signature is retired: never emitted anew.
    expect(html).not.toContain(SIM_PAGE_MARKER)
  })

  it('compiles markdown prose and headings through GFM', () => {
    const html = compileSimPage(SOURCE)
    expect(html).toContain('<h2>Summary</h2>')
    expect(html).toContain('<strong>not</strong>')
  })

  it('compiles sim:table with numeric column alignment', () => {
    const html = compileSimPage(SOURCE)
    expect(html).toContain('<div class="scroll"><table>')
    expect(html).toContain('<th class="num">Blocks</th>')
    expect(html).toContain('<td class="num">4</td>')
  })

  it('compiles kv fences into key rows', () => {
    const html = compileSimPage(
      '---\ntitle: T\n---\n```sim:kv\n- { key: "panel.ts:646", value: Reveal returns early. }\n```'
    )
    expect(html).toContain('<span class="key">panel.ts:646</span>')
  })

  it('compiles faq fences into native details rows', () => {
    const html = compileSimPage(
      '---\ntitle: T\n---\n```sim:faq\n- { q: What is this?, markdown: A compiled page. }\n```'
    )
    expect(html).toContain('<div class="faq">')
    expect(html).toContain('<summary>What is this?</summary>')
  })

  it('passes a diagram svg through inside a figure with its caption', () => {
    const html = compileSimPage(
      '---\ntitle: T\n---\n```sim:diagram The loop.\n<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>\n```'
    )
    expect(html).toContain('<figure><svg viewBox="0 0 10 10">')
    expect(html).toContain('<figcaption>The loop.</figcaption>')
  })

  // Authoring mistakes surface on the page the author reads, not in a log.
  // A malformed block renders NOTHING for the reader; the skip is reported
  // only through diagnostics, which apply_file_edit hands back to the agent.
  it('omits a malformed structured fence and reports it as a diagnostic', () => {
    const source = '---\ntitle: T\n---\n```sim:kv\n- { key: }\n```'
    expect(compileSimPage(source)).not.toContain('was skipped')
    expect(collectSimPageDiagnostics(source)).toEqual([
      'sim:kv block skipped: its payload did not match the expected shape',
    ])
  })

  it('omits retired fence kinds and reports them as diagnostics', () => {
    const source = '---\ntitle: T\n---\n```sim:cards\n- title: X\n```'
    expect(compileSimPage(source)).not.toContain('sim:cards')
    expect(collectSimPageDiagnostics(source)).toEqual([
      'sim:cards block skipped: its payload did not match the expected shape',
    ])
  })

  it('reports nothing for a fully valid page', () => {
    expect(
      collectSimPageDiagnostics('---\ntitle: T\n---\n```sim:kv\n- key: A\n  value: B\n```')
    ).toEqual([])
  })

  it('renders inline markdown in table cells and resolves sim links', () => {
    const html = compileSimPage(
      '---\ntitle: T\n---\n```sim:table\ncolumns: [Name]\nrows:\n  - ["[gateway](sim:workflow/wf1)"]\n```',
      { workspaceId: 'ws1' }
    )
    expect(html).toContain('<a href="/workspace/ws1/w/wf1" data-sim-link="">gateway</a>')
  })

  it('sends external links to a new tab on every surface', () => {
    const html = compileSimPage(
      '---\ntitle: T\n---\nSee the [Sim docs](https://docs.sim.ai/start).'
    )
    expect(html).toContain(
      '<a href="https://docs.sim.ai/start" target="_blank" rel="noopener noreferrer">'
    )
  })

  it('resolves workspace image refs to the authed byte route', () => {
    const html = compileSimPage('---\ntitle: T\n---\n![diagram](sim:file/img9)')
    expect(html).toContain('src="/api/files/view/img9"')
  })

  it('keeps a lone next card right-aligned with a spacer', () => {
    const html = compileSimPage('---\ntitle: T\nnext: "[API](sim:file/b)"\n---\nBody.')
    expect(html).toContain('<div class="page-nav-spacer"></div><a class="page-nav-card next"')
  })

  it('renders frontmatter prev/next as footer pagination cards', () => {
    const html = compileSimPage(
      '---\ntitle: T\nprev: "[Getting Started](sim:file/a)"\nnext: "[API Reference](sim:file/b)"\n---\nBody.',
      { workspaceId: 'ws1' }
    )
    expect(html).toContain('<footer class="page-nav">')
    expect(html).toContain('class="page-nav-card prev"')
    expect(html).toContain('Getting Started')
    expect(html).toContain('href="/workspace/ws1/files/b"')
    // The docs' PageFooter shape: chevron + name, no Previous/Next labels.
    expect(html).toContain('M6.25 3L13.25 10.25L6.25 17.5')
    expect(html).not.toContain('Previous')
  })

  it('tolerates nav frontmatter without rendering a sidebar', () => {
    const html = compileSimPage(
      '---\ntitle: Overview\nnav:\n  - label: Get Started\n    pages:\n      - "[Overview](sim:file/a)"\n      - "[API Reference](sim:file/b)"\n---\nBody.',
      { workspaceId: 'ws1' }
    )
    expect(html).not.toContain('set-nav')
    expect(html).toContain('Body.')
  })

  it('renders sim:accordion like sim:faq with title keys', () => {
    const html = compileSimPage(
      '---\ntitle: T\n---\n```sim:accordion\n- title: Advanced options\n  markdown: The details.\n```'
    )
    expect(html).toContain('<div class="faq">')
    expect(html).toContain('<summary>Advanced options</summary>')
  })

  it('escapes html in yaml-derived values', () => {
    const html = compileSimPage(
      '---\ntitle: T\n---\n```sim:kv\n- { key: "<script>", value: "<img src=x>" }\n```'
    )
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<img src=x>')
  })
})

describe('isHandWrittenCompiledPage', () => {
  it('rejects content carrying the compiler signature', () => {
    expect(isHandWrittenCompiledPage(`<!DOCTYPE html>\n${SIM_PAGE_MARKER}\n<h1>x</h1>`)).toBe(true)
  })

  it('rejects an artifact-opted document with no styles of its own', () => {
    expect(
      isHandWrittenCompiledPage(
        '<!DOCTYPE html><html><head><meta name="sim-artifact"></head><body><h1>x</h1></body></html>'
      )
    ).toBe(true)
  })

  it('allows a genuine bespoke page with inline styles', () => {
    expect(
      isHandWrittenCompiledPage(
        '<!DOCTYPE html><html><head><style>body{color:#111}</style></head><body>custom</body></html>'
      )
    ).toBe(false)
  })

  it('allows page source', () => {
    expect(isHandWrittenCompiledPage(SOURCE)).toBe(false)
  })
})
