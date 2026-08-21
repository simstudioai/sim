/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { compileSimPage } from '@/lib/workspace-files/page-compile'
import {
  extractSimPageSource,
  MAX_SIM_PAGE_UPLOAD_SNIFF_BYTES,
  restoreSimPageSourceBuffer,
  simPageSourceEmbedBlock,
} from '@/lib/workspace-files/page-source-embed'

const SOURCE = `---
title: Elder Guide
lede: How the Elder works.
---

## Overview

Prose with \`inline code\`, a </script> literal, and unicode — café ★.

\`\`\`sim:callout
The must-not-miss constraint.
\`\`\`
`

/** The standalone-document shape: compiled output with the embed in its head. */
function compiledDocumentWithEmbed(source: string): string {
  return compileSimPage(source, { baseUrl: 'https://sim.ai' }).replace(
    '</head>',
    `${simPageSourceEmbedBlock(source)}</head>`
  )
}

describe('simPageSourceEmbedBlock / extractSimPageSource', () => {
  it('round-trips source through a compiled document, including </script> and unicode', () => {
    expect(extractSimPageSource(compiledDocumentWithEmbed(SOURCE))).toBe(SOURCE)
  })

  it('emits no literal </script> inside the block for source containing one', () => {
    const block = simPageSourceEmbedBlock(SOURCE)
    expect(block.indexOf('</script>')).toBe(block.length - '</script>'.length)
  })

  it('returns null for a document without an embed block', () => {
    expect(extractSimPageSource(compileSimPage(SOURCE, { baseUrl: 'https://sim.ai' }))).toBeNull()
  })

  it('returns null when the embedded bytes are not valid page source', () => {
    const forged = `<head><script type="text/x-sim-page-source">${Buffer.from(
      '<p>not page source</p>'
    ).toString('base64')}</script></head>`
    expect(extractSimPageSource(forged)).toBeNull()
  })
})

describe('restoreSimPageSourceBuffer', () => {
  it('restores the embedded source from a compiled .html upload and drops the extension', () => {
    const restored = restoreSimPageSourceBuffer(
      'Elder Guide.html',
      Buffer.from(compiledDocumentWithEmbed(SOURCE), 'utf8')
    )
    expect(restored?.name).toBe('Elder Guide')
    expect(restored?.buffer.toString('utf8')).toBe(SOURCE)
  })

  it('passes raw page source through unchanged (idempotent replay)', () => {
    const buffer = Buffer.from(SOURCE, 'utf8')
    const restored = restoreSimPageSourceBuffer('Elder Guide.html', buffer)
    expect(restored?.name).toBe('Elder Guide')
    expect(restored?.buffer).toBe(buffer)
  })

  it('ignores non-.html names, plain HTML, empty, and oversized uploads', () => {
    expect(restoreSimPageSourceBuffer('notes.md', Buffer.from(SOURCE))).toBeNull()
    expect(
      restoreSimPageSourceBuffer('site.html', Buffer.from('<!doctype html><p>plain</p>'))
    ).toBeNull()
    expect(restoreSimPageSourceBuffer('empty.html', Buffer.alloc(0))).toBeNull()
    const oversized = Buffer.alloc(MAX_SIM_PAGE_UPLOAD_SNIFF_BYTES + 1)
    expect(restoreSimPageSourceBuffer('big.html', oversized)).toBeNull()
  })
})
