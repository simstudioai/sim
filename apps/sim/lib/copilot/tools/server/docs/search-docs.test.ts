/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocsSearchOutcome } from '@/lib/copilot/docs/docs-search'

const { mockSearchDocs } = vi.hoisted(() => ({
  mockSearchDocs: vi.fn(),
}))

vi.mock('@/lib/copilot/docs/docs-search', () => ({
  searchDocs: mockSearchDocs,
}))

import { searchDocsServerTool } from '@/lib/copilot/tools/server/docs/search-docs'

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

describe('searchDocsServerTool', () => {
  beforeEach(() => {
    mockSearchDocs.mockReset()
  })

  it('forwards query, path, and topK to the search layer', async () => {
    mockSearchDocs.mockResolvedValue(outcome({ results: [RESULT], candidatesConsidered: 1 }))

    const output = await searchDocsServerTool.execute({
      query: 'how do agents work',
      path: 'docs/agents.mdx',
      topK: 7,
    })

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

    const output = await searchDocsServerTool.execute({ query: 'q' })

    expect(output.note).toBeUndefined()
  })

  it('explains an empty result set caused by filtering, so it does not read as missing docs', async () => {
    mockSearchDocs.mockResolvedValue(
      outcome({ candidatesConsidered: 2, droppedBelowThreshold: 1, droppedStale: 1 })
    )

    const output = await searchDocsServerTool.execute({ query: 'q' })

    expect(output.note).toContain('does NOT mean the docs lack this topic')
    expect(output.note).toContain('1 scored too low')
    expect(output.note).toContain('1 point at pages no longer in the docs')
  })

  it('notes threshold-only drops on a partial result set', async () => {
    mockSearchDocs.mockResolvedValue(
      outcome({ results: [RESULT], candidatesConsidered: 3, droppedBelowThreshold: 2 })
    )

    const output = await searchDocsServerTool.execute({ query: 'q' })

    expect(output.note).toContain('Returned 1 of 3 candidate(s)')
    expect(output.note).toContain('2 scored too low')
    expect(output.note).not.toContain('no longer in the docs')
  })

  it('notes stale-only drops on a partial result set', async () => {
    mockSearchDocs.mockResolvedValue(
      outcome({ results: [RESULT], candidatesConsidered: 2, droppedStale: 1 })
    )

    const output = await searchDocsServerTool.execute({ query: 'q' })

    expect(output.note).toContain('1 point at pages no longer in the docs')
    expect(output.note).not.toContain('scored too low')
  })
})
