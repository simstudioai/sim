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
      'sim:kv block starting "- { key: }" skipped: its payload did not match the expected shape',
    ])
  })

  it('omits retired fence kinds and reports them as diagnostics', () => {
    const source = '---\ntitle: T\n---\n```sim:cards\n- title: X\n```'
    expect(compileSimPage(source)).not.toContain('sim:cards')
    expect(collectSimPageDiagnostics(source)).toEqual([
      'sim:cards block starting "- title: X" skipped: its payload did not match the expected shape',
    ])
  })

  // A page can carry several blocks of the same kind — the diagnostic must
  // name WHICH one failed and distinguish a YAML syntax error from a shape
  // mismatch, or "a table is malformed" sends the fixer hunting through all
  // of them.
  it('identifies the failing block by its first payload line and reports YAML errors', () => {
    const source = [
      '---',
      'title: T',
      '---',
      '```sim:table',
      'columns: [A, B]',
      'rows:',
      '  - [a, b]',
      '```',
      '',
      '```sim:table',
      'columns: [C: D]',
      'rows: broken',
      '```',
    ].join('\n')
    const diagnostics = collectSimPageDiagnostics(source)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toContain('sim:table block starting "columns: [C: D]"')
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

  it('renders the tabs frontmatter as the docs tab row above the title', () => {
    const html = compileSimPage(
      '---\ntitle: Overview\ntabs:\n  - "Overview"\n  - "[API Reference](sim:file/b)"\n  - "[CLI](sim:file/c)"\n---\nBody.',
      { workspaceId: 'ws1' }
    )
    expect(html).toContain('<nav class="page-tabs" aria-label="Pages">')
    // The bare-label entry IS this page: the active, unlinked tab.
    expect(html).toContain('<span class="page-tab is-active">Overview</span>')
    // Linked entries resolve through the normal sim: link pass.
    expect(html).toContain(
      '<a class="page-tab" href="/workspace/ws1/files/b" data-sim-link="">API Reference</a>'
    )
    // Tabs precede the title, the docs' top-row placement.
    expect(html.indexOf('page-tabs')).toBeLessThan(html.indexOf('<h1>'))
  })

  it('renders no tab row for a single page', () => {
    expect(compileSimPage('---\ntitle: T\n---\nBody.')).not.toContain('page-tabs')
  })

  it('tolerates prev/next frontmatter without rendering pagination', () => {
    const html = compileSimPage(
      '---\ntitle: T\nprev: "[Getting Started](sim:file/a)"\nnext: "[API Reference](sim:file/b)"\n---\nBody.',
      { workspaceId: 'ws1' }
    )
    expect(html).not.toContain('page-nav')
    expect(html).toContain('Body.')
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

describe('in-document tabs', () => {
  const TABBED = `---
title: API Guide
---

Shared intro paragraph.

# Overview

## Getting started

Overview body.

# Reference

## Endpoints

Reference body.
`

  it('turns two top-level headings into tab buttons and panels', () => {
    const html = compileSimPage(TABBED)
    expect(html).toContain('data-doc-tabs')
    expect(html).toContain('data-tab-target="doc-tab-0"')
    expect(html).toContain('>Overview</button>')
    expect(html).toContain('>Reference</button>')
    expect(html).toContain('id="doc-tab-0" data-tab-panel')
    expect(html).toContain('id="doc-tab-1" data-tab-panel')
    expect(html.match(/doc-tab-panel is-active/g)).toHaveLength(1)
    expect(html).toContain('Overview body.')
    expect(html).toContain('Reference body.')
  })

  it('renders content before the first heading outside the panels', () => {
    const html = compileSimPage(TABBED)
    const intro = html.indexOf('Shared intro paragraph.')
    const firstPanel = html.indexOf('data-tab-panel')
    expect(intro).toBeGreaterThan(-1)
    expect(intro).toBeLessThan(firstPanel)
  })

  it('includes the client-side switcher script', () => {
    expect(compileSimPage(TABBED)).toContain('data-doc-tabs] .page-tab')
  })

  it('ignores # lines inside code fences', () => {
    const html = compileSimPage(`---
title: One Pager
---

# Only Tab

\`\`\`bash
# a comment, not a tab
echo hi
\`\`\`

# Second Tab

Body.
`)
    expect(html).toContain('data-doc-tabs')
    expect(html).not.toContain('>a comment, not a tab</button>')
    expect(html.match(/data-tab-target/g)).toHaveLength(2)
  })

  it('leaves a single top-level heading untabbed', () => {
    const html = compileSimPage(`---
title: Plain
---

# Just A Heading

Body text.
`)
    expect(html).not.toContain('data-doc-tabs')
    expect(html).toContain('Body text.')
  })

  it('prefers in-file tabs over the frontmatter set tabs', () => {
    const html = compileSimPage(`---
title: Guide
tabs:
  - Guide
  - "[Other](sim:file/abc)"
---

# First

A.

# Second

B.
`)
    expect(html).toContain('data-doc-tabs')
    expect(html).not.toContain('sim:file/abc')
  })
})
