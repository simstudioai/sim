/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  compileSimPageChunk,
  isSimPageSource,
  SIM_PAGE_MARKER,
} from '@/lib/copilot/tools/server/files/page-compile'

const FIRST_CHUNK = `---
title: Workspace Overview
eyebrow: Snapshot · 18 August 2026
lede: A concise inventory.
---

## Summary

An experimentation workspace, **not** a production estate.

\`\`\`sim:stats
- { label: Workflows, value: 5, note: 2 deployed, tone: ok }
- { label: Tables, value: 8, note: 0 rows loaded, tone: warn }
\`\`\`
`

describe('isSimPageSource', () => {
  it('recognises a first chunk by its titled frontmatter', () => {
    expect(isSimPageSource(FIRST_CHUNK, '')).toBe(true)
  })

  it('recognises continuations by the marker in the stored file', () => {
    expect(
      isSimPageSource('## More\n\nProse.', `<!DOCTYPE html>\n${SIM_PAGE_MARKER}\n<h1>x</h1>`)
    ).toBe(true)
  })

  // Raw HTML is the bespoke escape hatch and must never be recompiled.
  it('passes raw HTML through untouched', () => {
    expect(isSimPageSource('<!DOCTYPE html><html><body>custom</body></html>', '')).toBe(false)
  })

  it('ignores plain markdown-looking content without frontmatter', () => {
    expect(isSimPageSource('# Title\n\nBody.', '')).toBe(false)
  })

  it('never treats appends to a non-compiled html file as source', () => {
    expect(isSimPageSource('## More', '<!DOCTYPE html><body>hand-written</body>')).toBe(false)
  })
})

describe('compileSimPageChunk', () => {
  it('emits the document head, marker, and page container from frontmatter', () => {
    const html = compileSimPageChunk(FIRST_CHUNK, true)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<meta name="sim-artifact">')
    expect(html).toContain('<title>Workspace Overview</title>')
    expect(html).toContain(SIM_PAGE_MARKER)
    expect(html).toContain('<div class="page" data-layout="docs">')
    expect(html).toContain('<h1>Workspace Overview</h1>')
    expect(html).toContain('<p class="lede">A concise inventory.</p>')
    // Append-friendly by construction: the optional closing tags stay unwritten.
    expect(html).not.toContain('</body>')
    expect(html).not.toContain('</html>')
  })

  it('compiles markdown prose and headings through GFM', () => {
    const html = compileSimPageChunk(FIRST_CHUNK, true)
    expect(html).toContain('<h2>Summary</h2>')
    expect(html).toContain('<strong>not</strong>')
  })

  it('compiles sim:stats into the page vocabulary with badge pills', () => {
    const html = compileSimPageChunk(FIRST_CHUNK, true)
    expect(html).toContain('<div class="stat-label">Workflows</div>')
    expect(html).toContain('<div class="stat">5</div>')
    expect(html).toContain('<span class="pill pill--ok">2 deployed</span>')
    expect(html).toContain('<span class="pill pill--warn">0 rows loaded</span>')
  })

  it('compiles continuation chunks as bare fragments', () => {
    const html = compileSimPageChunk(
      '## Details\n\n```sim:kv\n- { key: "panel.ts:646", value: Reveal returns early. }\n```',
      false
    )
    expect(html).toContain('<h2>Details</h2>')
    expect(html).toContain('<span class="key">panel.ts:646</span>')
    expect(html).not.toContain('<!DOCTYPE html>')
  })

  it('compiles faq fences into native details rows', () => {
    const html = compileSimPageChunk(
      '```sim:faq\n- { q: What is this?, markdown: A compiled page. }\n```',
      false
    )
    expect(html).toContain('<div class="faq">')
    expect(html).toContain('<summary>What is this?</summary>')
  })

  it('passes a diagram svg through inside a figure with its caption', () => {
    const html = compileSimPageChunk(
      '```sim:diagram The loop.\n<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>\n```',
      false
    )
    expect(html).toContain('<figure><svg viewBox="0 0 10 10">')
    expect(html).toContain('<figcaption>The loop.</figcaption>')
  })

  // Authoring mistakes surface on the page the author reads, not in a log.
  it('renders a visible notice for a malformed structured fence', () => {
    const html = compileSimPageChunk('```sim:stats\n- { label: }\n```', false)
    expect(html).toContain('was skipped')
  })

  it('escapes html in yaml-derived values', () => {
    const html = compileSimPageChunk(
      '```sim:kv\n- { key: "<script>", value: "<img src=x>" }\n```',
      false
    )
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<img src=x>')
  })
})
