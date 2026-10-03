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

  // Files stored by the retired write-time compiler stay renderable as-is.
  it('is false for legacy stored-compiled pages', () => {
    expect(isSimPageSource(`<!DOCTYPE html>\n${SIM_PAGE_MARKER}\n<h1>x</h1>`)).toBe(false)
  })
})

describe('compileSimPage', () => {
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
})
