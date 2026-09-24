/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { parseDeleteSearchIndexDocumentsArgs } from '@/scripts/dormant-org-search/delete-search-index-documents'

describe('parseDeleteSearchIndexDocumentsArgs', () => {
  it('defaults to a dry run with the documented bounds', () => {
    expect(parseDeleteSearchIndexDocumentsArgs(['--knowledge-base-id=kb-1'])).toEqual({
      knowledgeBaseId: 'kb-1',
      execute: false,
      pageSize: 200,
      chunkBatchSize: 1_000,
      pauseMs: 250,
      maxPages: undefined,
      afterId: '',
      storageCleanupCeiling: 2_000,
      resetConnectors: true,
      lockTimeoutMs: 5_000,
      statementTimeoutMs: 60_000,
    })
  })

  it('writes only with --execute', () => {
    expect(
      parseDeleteSearchIndexDocumentsArgs(['--knowledge-base-id=kb-1', '--execute']).execute
    ).toBe(true)
    expect(
      parseDeleteSearchIndexDocumentsArgs(['--knowledge-base-id=kb-1', '--dry-run']).execute
    ).toBe(false)
    expect(() =>
      parseDeleteSearchIndexDocumentsArgs(['--knowledge-base-id=kb-1', '--execute', '--dry-run'])
    ).toThrow('not both')
  })

  it('parses resume and bound flags', () => {
    expect(
      parseDeleteSearchIndexDocumentsArgs([
        '--knowledge-base-id=kb-1',
        '--max-pages=5',
        '--after-id=doc-9',
        '--pause-ms=0',
        '--no-connector-reset',
      ])
    ).toMatchObject({ maxPages: 5, afterId: 'doc-9', pauseMs: 0, resetConnectors: false })
  })

  it('refuses a missing base, unknown flags and non-positive bounds', () => {
    expect(() => parseDeleteSearchIndexDocumentsArgs([])).toThrow('--knowledge-base-id')
    expect(() =>
      parseDeleteSearchIndexDocumentsArgs(['--knowledge-base-id=kb-1', '--force'])
    ).toThrow()
    expect(() =>
      parseDeleteSearchIndexDocumentsArgs(['--knowledge-base-id=kb-1', '--page-size=0'])
    ).toThrow('positive integer')
    expect(() =>
      parseDeleteSearchIndexDocumentsArgs(['--knowledge-base-id=kb-1', '--max-pages=1.5'])
    ).toThrow('positive integer')
  })
})
