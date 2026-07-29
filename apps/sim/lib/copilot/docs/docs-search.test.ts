/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGenerateSearchEmbedding, capturedWhere, capturedLimit, mockRows } = vi.hoisted(() => ({
  mockGenerateSearchEmbedding: vi.fn(),
  capturedWhere: { value: undefined as unknown },
  capturedLimit: { value: undefined as number | undefined },
  mockRows: { value: [] as unknown[] },
}))

vi.mock('@/lib/knowledge/embeddings', () => ({
  generateSearchEmbedding: mockGenerateSearchEmbedding,
}))

/**
 * Override the global drizzle mock with operators that record their arguments,
 * so a test can assert on the `source_document` filter the scope produced.
 */
vi.mock('drizzle-orm', () => {
  const op =
    (name: string) =>
    (...args: unknown[]) => ({ op: name, args })
  return {
    and: op('and'),
    or: op('or'),
    eq: op('eq'),
    ne: op('ne'),
    like: op('like'),
    notLike: op('notLike'),
    sql: (strings: TemplateStringsArray) => ({ op: 'sql', text: strings.join('?') }),
  }
})

vi.mock('@sim/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          capturedWhere.value = condition
          return {
            orderBy: () => ({
              limit: async (n: number) => {
                capturedLimit.value = n
                return mockRows.value
              },
            }),
          }
        },
      }),
    }),
  },
}))

import { DocsSearchScopeError, searchDocs } from '@/lib/copilot/docs/docs-search'

/** Render a drizzle condition to comparable SQL-ish text for assertions. */
function whereText(): string {
  return JSON.stringify(capturedWhere.value)
}

describe('searchDocs path scoping', () => {
  beforeEach(() => {
    capturedWhere.value = undefined
    mockRows.value = []
    mockGenerateSearchEmbedding.mockResolvedValue({ embedding: [0.1, 0.2] })
  })

  it('excludes unmounted sections when unscoped', async () => {
    await searchDocs('cron')
    expect(whereText()).toContain('academy/%')
    expect(whereText()).toContain('api-reference/%')
  })

  it('treats a bare docs prefix as unscoped', async () => {
    await searchDocs('cron', { path: 'docs/' })
    expect(whereText()).toContain('academy/%')
  })

  it('excludes the root homepage when unscoped — its chunks have no live docs/ path', async () => {
    await searchDocs('cron')
    expect(whereText()).toContain('"op":"ne"')
    expect(whereText()).toContain('index.mdx')
  })

  it('scopes a page to both on-disk layouts', async () => {
    await searchDocs('cron', { path: 'docs/workflows/blocks/agent.mdx' })
    const text = whereText()
    expect(text).toContain('workflows/blocks/agent.mdx')
    expect(text).toContain('workflows/blocks/agent/index.mdx')
  })

  it('maps a section overview page onto its index file', async () => {
    await searchDocs('cron', { path: 'docs/workflows.mdx' })
    const text = whereText()
    expect(text).toContain('workflows/index.mdx')
  })

  it('scopes a directory to its subtree', async () => {
    await searchDocs('cron', { path: 'docs/workflows' })
    expect(whereText()).toContain('workflows/%')
  })

  it('includes a section overview stored in either on-disk layout', async () => {
    await searchDocs('cron', { path: 'docs/workflows' })
    const text = whereText()
    // `workflows/index.mdx` is inside the subtree; a sibling `workflows.mdx` is not,
    // and fumadocs accepts either, so the scope must name it explicitly.
    expect(text).toContain('workflows/%')
    expect(text).toContain('workflows.mdx')
  })

  it('rejects a path outside the docs corpus', async () => {
    await expect(searchDocs('cron', { path: 'files/report.pdf' })).rejects.toThrow(
      DocsSearchScopeError
    )
  })

  it('rejects a docs path that is neither a page nor a section', async () => {
    await expect(searchDocs('cron', { path: 'docs/not-a-real-section' })).rejects.toThrow(
      /not a page or section/
    )
  })

  it('rejects unmounted sections that exist on the site but not in the VFS', async () => {
    await expect(searchDocs('cron', { path: 'docs/academy' })).rejects.toThrow(
      /not a page or section/
    )
  })
})

describe('searchDocs results', () => {
  beforeEach(() => {
    capturedWhere.value = undefined
    mockGenerateSearchEmbedding.mockResolvedValue({ embedding: [0.1, 0.2] })
  })

  it('returns the docs/ path to read next, folding index pages', async () => {
    mockRows.value = [
      {
        chunkText: 'body',
        sourceDocument: 'workflows/index.mdx',
        sourceLink: 'https://docs.sim.ai/workflows',
        headerText: 'Overview',
        similarity: 0.8,
      },
    ]
    const { results } = await searchDocs('cron')
    expect(results).toEqual([
      {
        path: 'docs/workflows.mdx',
        url: 'https://docs.sim.ai/workflows',
        title: 'Overview',
        content: 'body',
        similarity: 0.8,
      },
    ])
  })

  it('drops chunks whose source has no live docs/ path', async () => {
    mockRows.value = [
      {
        chunkText: 'a',
        sourceDocument: 'academy/lesson-1.mdx',
        sourceLink: 'x',
        headerText: 'h',
        similarity: 0.9,
      },
      {
        chunkText: 'b',
        sourceDocument: 'deleted-page.mdx',
        sourceLink: 'y',
        headerText: 'h',
        similarity: 0.9,
      },
    ]
    expect((await searchDocs('cron')).results).toEqual([])
  })

  it('returns the zero-candidate outcome without querying when the embedding is empty', async () => {
    mockGenerateSearchEmbedding.mockResolvedValue({ embedding: [] })
    const outcome = await searchDocs('cron')
    expect(outcome).toEqual({
      results: [],
      candidatesConsidered: 0,
      droppedBelowThreshold: 0,
      droppedStale: 0,
    })
  })

  it('drops chunks below the similarity threshold', async () => {
    mockRows.value = [
      {
        chunkText: 'a',
        sourceDocument: 'agents.mdx',
        sourceLink: 'x',
        headerText: 'h',
        similarity: 0.1,
      },
    ]
    expect((await searchDocs('cron')).results).toEqual([])
  })
})

describe('searchDocs shortfall reporting', () => {
  beforeEach(() => {
    capturedWhere.value = undefined
    mockGenerateSearchEmbedding.mockResolvedValue({ embedding: [0.1, 0.2] })
  })

  it('counts why candidates were dropped so an empty set is explainable', async () => {
    mockRows.value = [
      {
        chunkText: 'a',
        sourceDocument: 'agents.mdx',
        sourceLink: 'x',
        headerText: 'h',
        similarity: 0.1,
      },
      {
        chunkText: 'b',
        sourceDocument: 'deleted-page.mdx',
        sourceLink: 'y',
        headerText: 'h',
        similarity: 0.9,
      },
    ]
    const outcome = await searchDocs('cron')
    expect(outcome).toEqual({
      results: [],
      candidatesConsidered: 2,
      droppedBelowThreshold: 1,
      droppedStale: 1,
    })
  })

  it('reports no drops when every candidate survives', async () => {
    mockRows.value = [
      {
        chunkText: 'a',
        sourceDocument: 'agents.mdx',
        sourceLink: 'x',
        headerText: 'h',
        similarity: 0.9,
      },
    ]
    const outcome = await searchDocs('cron')
    expect(outcome.droppedBelowThreshold).toBe(0)
    expect(outcome.droppedStale).toBe(0)
    expect(outcome.results).toHaveLength(1)
  })
})

describe('searchDocs topK clamping', () => {
  beforeEach(() => {
    capturedLimit.value = undefined
    mockRows.value = []
    mockGenerateSearchEmbedding.mockResolvedValue({ embedding: [0.1, 0.2] })
  })

  it('defaults to 5 when unspecified', async () => {
    await searchDocs('cron')
    expect(capturedLimit.value).toBe(5)
  })

  it('caps at 25 — the documented max, which the old tool never enforced', async () => {
    await searchDocs('cron', { topK: 500 })
    expect(capturedLimit.value).toBe(25)
  })

  it('floors at 1', async () => {
    await searchDocs('cron', { topK: 0 })
    expect(capturedLimit.value).toBe(1)
    await searchDocs('cron', { topK: -8 })
    expect(capturedLimit.value).toBe(1)
  })

  it('truncates a fractional count', async () => {
    await searchDocs('cron', { topK: 7.9 })
    expect(capturedLimit.value).toBe(7)
  })

  it('falls back to the default rather than passing NaN to the query', async () => {
    // Math.min/Math.max propagate NaN, so a bare clamp would reach `.limit(NaN)`.
    await searchDocs('cron', { topK: Number.NaN })
    expect(capturedLimit.value).toBe(5)
    await searchDocs('cron', { topK: 'twelve' as unknown as number })
    expect(capturedLimit.value).toBe(5)
    await searchDocs('cron', { topK: Number.POSITIVE_INFINITY })
    expect(capturedLimit.value).toBe(5)
  })
})
