import { describe, expect, it } from 'vitest'
import {
  v2CreateKnowledgeBaseContract,
  v2CreateKnowledgeDocumentUploadContract,
  v2CreateKnowledgeFolderContract,
  v2ListKnowledgeDocumentsContract,
  v2SearchKnowledgeContract,
  v2UploadKnowledgeDocumentContract,
} from '@/lib/api/contracts/v2/knowledge'

function issueMessages(result: { error?: { issues: readonly { message: string }[] } }): string[] {
  return (result.error?.issues ?? []).map((issue) => issue.message)
}

describe('v2 knowledge contracts', () => {
  it('declares 201 for every resource-creation response', () => {
    expect(v2CreateKnowledgeBaseContract.response.status).toBe(201)
    expect(v2CreateKnowledgeFolderContract.response.status).toBe(201)
    expect(v2UploadKnowledgeDocumentContract.response.status).toBe(201)
    expect(v2CreateKnowledgeDocumentUploadContract.response.status).toBe(201)
  })

  it('preserves knowledge search bounds', () => {
    const valid = v2SearchKnowledgeContract.body?.safeParse({
      workspaceId: 'workspace-1',
      knowledgeBaseIds: Array.from({ length: 20 }, (_, index) => `kb-${index}`),
      query: 'support',
      topK: 100,
    })
    const tooManyKnowledgeBases = v2SearchKnowledgeContract.body?.safeParse({
      workspaceId: 'workspace-1',
      knowledgeBaseIds: Array.from({ length: 21 }, (_, index) => `kb-${index}`),
      query: 'support',
      topK: 100,
    })
    const excessiveTopK = v2SearchKnowledgeContract.body?.safeParse({
      workspaceId: 'workspace-1',
      knowledgeBaseIds: ['kb-1'],
      query: 'support',
      topK: 101,
    })

    expect(valid?.success).toBe(true)
    expect(tooManyKnowledgeBases?.success).toBe(false)
    expect(excessiveTopK?.success).toBe(false)
  })

  /**
   * A dropped key here is not a cosmetic difference: `rerankerEnabled` and
   * `topK` both decide how many search units the request is billed, so a
   * mis-cased key that parses to 200 charges the caller for a search they did
   * not ask for and returns results they did not configure.
   */
  it.each(['rerankerenabled', 'topk', 'rerankermodel', 'searchmode'])(
    'rejects the mis-cased billing-relevant key %s instead of dropping it',
    (key) => {
      const parsed = v2SearchKnowledgeContract.body?.safeParse({
        workspaceId: 'workspace-1',
        knowledgeBaseIds: ['kb-1'],
        query: 'support',
        [key]: key === 'topk' ? 50 : true,
      })
      expect(parsed?.success).toBe(false)
    }
  )

  it('still accepts the correctly spelled reranking fields', () => {
    const parsed = v2SearchKnowledgeContract.body?.safeParse({
      workspaceId: 'workspace-1',
      knowledgeBaseIds: ['kb-1'],
      query: 'support',
      topK: 50,
      rerankerEnabled: true,
    })
    expect(parsed?.success).toBe(true)
  })
})

function parseTagFilter(filter: unknown) {
  return v2SearchKnowledgeContract.body?.safeParse({
    workspaceId: 'workspace-1',
    knowledgeBaseIds: ['kb-1'],
    query: 'support',
    tagFilters: [filter],
  })
}

/**
 * An operator the builders do not implement used to be admitted here and then
 * diverge downstream: the document list dropped the predicate and answered with
 * the whole knowledge base, while search fell through to equality. The same trap
 * the search body closed with `.strict()` was left open in the array element, so
 * a mis-cased `valueto` was stripped and its `between` filter lost its bound.
 */
describe('v2 knowledge search tag filter', () => {
  it('rejects an operator no field type implements', () => {
    expect(
      parseTagFilter({ tagName: 'category', operator: 'nosuchop', value: 'billing' })?.success
    ).toBe(false)
  })

  it('rejects "between" with no valueTo', () => {
    const parsed = parseTagFilter({ tagName: 'score', operator: 'between', value: 1 })
    expect(parsed?.success).toBe(false)
    expect(issueMessages(parsed as never)).toContain(
      'valueTo is required when operator is "between"'
    )
  })

  it('rejects a mis-cased valueTo instead of stripping it', () => {
    expect(
      parseTagFilter({ tagName: 'score', operator: 'between', value: 1, valueto: 5 })?.success
    ).toBe(false)
  })

  it.each([
    'eq',
    'neq',
    'contains',
    'not_contains',
    'starts_with',
    'ends_with',
    'gt',
    'gte',
    'lt',
    'lte',
  ])('still accepts the implemented operator %s', (operator) => {
    expect(parseTagFilter({ tagName: 'category', operator, value: 'billing' })?.success).toBe(true)
  })

  it('still accepts a bounded between filter', () => {
    expect(
      parseTagFilter({ tagName: 'score', operator: 'between', value: 1, valueTo: 5 })?.success
    ).toBe(true)
  })

  it('still defaults a filter that names no operator', () => {
    const parsed = parseTagFilter({ tagName: 'category', value: 'billing' })
    expect(parsed?.success).toBe(true)
    expect(
      (parsed as { data: { tagFilters: { operator: string }[] } }).data.tagFilters[0].operator
    ).toBe('eq')
  })
})

/**
 * The document list inherited `limit` and `search` from the v1 shape, so it was
 * the one v2 list whose bounds and messages diverged from every sibling. An
 * empty `search` reaching an unindexed `LOWER(filename) LIKE` scan is the
 * concrete cost: `?search=` answered 200 with the full page while the sibling
 * `GET /knowledge?search=` answered 400.
 */
describe('v2 knowledge document list query', () => {
  const query = v2ListKnowledgeDocumentsContract.query

  it('rejects an empty search term', () => {
    const parsed = query?.safeParse({ workspaceId: 'ws-1', search: '' })
    expect(parsed?.success).toBe(false)
    expect(issueMessages(parsed as never)).toContain('search cannot be empty')
  })

  it('rejects a search term past the shared 200-character bound', () => {
    const parsed = query?.safeParse({ workspaceId: 'ws-1', search: 'a'.repeat(201) })
    expect(parsed?.success).toBe(false)
    expect(issueMessages(parsed as never)).toContain('search is too long')
  })

  it('trims a search term the way every other v2 list does', () => {
    const parsed = query?.safeParse({ workspaceId: 'ws-1', search: '  invoice  ' })
    expect(parsed?.success).toBe(true)
    expect((parsed?.data as { search?: string } | undefined)?.search).toBe('invoice')
  })

  it.each([
    [0, 'limit must be at least 1'],
    [101, 'limit cannot exceed 100'],
  ])('names the failing bound for limit %s', (limit, message) => {
    const parsed = query?.safeParse({ workspaceId: 'ws-1', limit })
    expect(parsed?.success).toBe(false)
    expect(issueMessages(parsed as never)).toContain(message)
  })
})

/**
 * The write used to accept only `maxSize`/`minSize`/`overlap` while the read
 * projected five keys, so a `strategy` the workflow builder set was readable and
 * unwritable — and a three-key update replaced the stored object wholesale and
 * dropped it.
 */
describe('v2 knowledge chunking configuration', () => {
  const body = v2CreateKnowledgeBaseContract.body

  function parseChunkingConfig(chunkingConfig: unknown) {
    return body?.safeParse({ workspaceId: 'ws-1', name: 'Docs', chunkingConfig })
  }

  it('accepts the strategy and strategy options the read projects', () => {
    const parsed = parseChunkingConfig({
      maxSize: 1024,
      minSize: 100,
      overlap: 200,
      strategy: 'regex',
      strategyOptions: { pattern: '\\n\\n', strictBoundaries: true },
    })

    expect(parsed?.success).toBe(true)
  })

  it('still accepts a body naming only one of the numbers', () => {
    expect(parseChunkingConfig({ maxSize: 2048 })?.success).toBe(true)
  })

  it('requires a pattern for the regex strategy', () => {
    const parsed = parseChunkingConfig({ maxSize: 1024, minSize: 100, strategy: 'regex' })

    expect(parsed?.success).toBe(false)
    expect(issueMessages(parsed as never)).toContain(
      'Regex pattern is required when using the regex chunking strategy'
    )
  })

  it('rejects strict boundaries outside the regex strategy', () => {
    const parsed = parseChunkingConfig({
      maxSize: 1024,
      strategy: 'recursive',
      strategyOptions: { strictBoundaries: true },
    })

    expect(parsed?.success).toBe(false)
    expect(issueMessages(parsed as never)).toContain(
      'strictBoundaries is only valid for the regex chunking strategy'
    )
  })

  /**
   * The bound is load-bearing rather than cosmetic: the recursive chunker
   * rescans the whole document once per separator, synchronously, so an
   * unbounded list turns one persisted config into seconds of uninterruptible
   * CPU on every later upload.
   */
  it('bounds the separator list the recursive chunker rescans per entry', () => {
    const parsed = parseChunkingConfig({
      maxSize: 1024,
      strategyOptions: { separators: Array.from({ length: 200 }, () => '\n') },
    })

    expect(parsed?.success).toBe(false)
    expect(issueMessages(parsed as never).join(' ')).toContain('separators')
  })

  it('rejects an unknown chunking key rather than dropping it', () => {
    expect(parseChunkingConfig({ maxSize: 1024, mode: 'fast' })?.success).toBe(false)
  })

  /**
   * The response stays lenient in both directions. `knowledge_base.chunking_config`
   * is schemaless JSONB, so a legacy row carrying a retired key would fail a
   * strict response parse and reach the caller as a 500.
   */
  it('keeps the response tolerant of a stored key the input rejects', () => {
    const response = v2CreateKnowledgeBaseContract.response.schema.safeParse({
      data: {
        id: 'kb-1',
        webUrl: 'https://test.sim.ai/workspace/workspace-1/knowledge/kb-1',
        name: 'Docs',
        description: null,
        tokenCount: 0,
        embeddingModel: 'text-embedding-3-small',
        embeddingDimension: 1536,
        chunkingConfig: { maxSize: 1024, minSize: 100, overlap: 200, retiredKnob: true },
        docCount: 0,
        connectorTypes: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ownerEmail: 'owner@example.com',
        folderPath: '/',
        deletedAt: null,
      },
    })

    expect(response.success).toBe(true)
  })
})
