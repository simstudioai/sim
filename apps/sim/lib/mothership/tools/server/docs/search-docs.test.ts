/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocsSearchOutcome } from '@/lib/mothership/docs/docs-search'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const { mockSearchDocs } = vi.hoisted(() => ({
  mockSearchDocs: vi.fn(),
}))

vi.mock('@/lib/mothership/docs/docs-search', () => ({
  searchDocs: mockSearchDocs,
}))

import { searchDocsServerTool } from '@/lib/mothership/tools/server/docs/search-docs'

function outcome(overrides: Partial<DocsSearchOutcome>): DocsSearchOutcome {
  return {
    results: [],
    candidatesConsidered: 0,
    droppedBelowThreshold: 0,
    droppedStale: 0,
    ...overrides,
  }
}

const RESULT = {
  path: 'docs/agents.mdx',
  url: 'https://docs.sim.ai/agents',
  title: 'Agents',
  content: 'body',
  similarity: 0.9,
}

const CONTEXT = {
  userId: 'user-1',
  resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
}

describe('searchDocsServerTool', () => {
  beforeEach(() => {
    mockSearchDocs.mockReset()
  })

  it('forwards query, path, and topK to the search layer', async () => {
    mockSearchDocs.mockResolvedValue(outcome({ results: [RESULT], candidatesConsidered: 1 }))

    const output = await searchDocsServerTool.execute(
      {
        query: 'how do agents work',
        path: 'docs/agents.mdx',
        topK: 7,
      },
      CONTEXT
    )

    expect(mockSearchDocs).toHaveBeenCalledWith('how do agents work', {
      path: 'docs/agents.mdx',
      topK: 7,
    })
    expect(output).toEqual({
      results: [RESULT],
      query: 'how do agents work',
      totalResults: 1,
    })
  })

  it('omits the note when nothing was dropped', async () => {
    mockSearchDocs.mockResolvedValue(outcome({ results: [RESULT], candidatesConsidered: 1 }))

    const output = await searchDocsServerTool.execute({ query: 'q' }, CONTEXT)

    expect(output.note).toBeUndefined()
  })

  it('explains when the index returns no candidates', async () => {
    mockSearchDocs.mockResolvedValue(outcome({}))

    const output = await searchDocsServerTool.execute({ query: 'brand new feature' }, CONTEXT)

    expect(output.note).toContain('search index may lag')
    expect(output.note).toContain('blocks tips')
  })

  it('explains an empty result set caused by filtering, so it does not read as missing docs', async () => {
    mockSearchDocs.mockResolvedValue(
      outcome({ candidatesConsidered: 2, droppedBelowThreshold: 1, droppedStale: 1 })
    )

    const output = await searchDocsServerTool.execute({ query: 'q' }, CONTEXT)

    expect(output.note).toContain('does NOT mean the docs lack this topic')
    expect(output.note).toContain('1 scored too low')
    expect(output.note).toContain('1 point at pages no longer in the docs')
  })

  it('notes threshold-only drops on a partial result set', async () => {
    mockSearchDocs.mockResolvedValue(
      outcome({ results: [RESULT], candidatesConsidered: 3, droppedBelowThreshold: 2 })
    )

    const output = await searchDocsServerTool.execute({ query: 'q' }, CONTEXT)

    expect(output.note).toContain('Returned 1 of 3 candidate(s)')
    expect(output.note).toContain('2 scored too low')
    expect(output.note).not.toContain('no longer in the docs')
  })

  it('notes stale-only drops on a partial result set', async () => {
    mockSearchDocs.mockResolvedValue(
      outcome({ results: [RESULT], candidatesConsidered: 2, droppedStale: 1 })
    )

    const output = await searchDocsServerTool.execute({ query: 'q' }, CONTEXT)

    expect(output.note).toContain('1 point at pages no longer in the docs')
    expect(output.note).not.toContain('scored too low')
  })

  it('projects resolved secrets before embedding or returning the query', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'DOCS_QUERY',
        plaintext: 'private docs query',
        encryptedValue: 'ciphertext',
      },
    ])
    registry.recordResolved('DOCS_QUERY', 'private docs query')
    mockSearchDocs.mockResolvedValue(outcome({ results: [RESULT], candidatesConsidered: 1 }))

    const output = await searchDocsServerTool.execute(
      { query: 'private docs query' },
      { userId: 'user-1', resolvedSecretTraceRegistry: registry }
    )

    expect(mockSearchDocs).toHaveBeenCalledWith('{{DOCS_QUERY}}', {
      path: undefined,
      topK: undefined,
    })
    expect(output.query).toBe('{{DOCS_QUERY}}')
    expect(JSON.stringify(output)).not.toContain('private docs query')
  })

  it('fails closed when secret provenance is unavailable', async () => {
    await expect(searchDocsServerTool.execute({ query: 'query' })).rejects.toThrow(
      'Docs search query could not be processed safely'
    )
    expect(mockSearchDocs).not.toHaveBeenCalled()
  })
})
