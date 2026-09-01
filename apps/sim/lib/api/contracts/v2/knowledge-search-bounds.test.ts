/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_V2_KNOWLEDGE_DOCUMENT_TAG_FILTERS,
  MAX_V2_KNOWLEDGE_SEARCH_QUERY_LENGTH,
  parseV2KnowledgeTagFiltersParam,
  v2KnowledgeSearchBodySchema,
} from '@/lib/api/contracts/v2/knowledge'

const workspaceId = '7a6cce2b-78b8-40bc-b8d3-0a2a6dfd9023'
const knowledgeBaseIds = ['ae814592-a730-4ad6-8741-b51e48843300']

function tagFilters(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    tagName: 'Messages in Thread',
    operator: 'gte' as const,
    value: String(index),
  }))
}

function issueMessages(result: ReturnType<typeof v2KnowledgeSearchBodySchema.safeParse>) {
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

/**
 * Search is billed per call, so an input it cannot honour must be rejected at the
 * boundary rather than accepted and quietly reshaped.
 */
describe('v2 knowledge search body bounds', () => {
  it('accepts a query at the maximum length', () => {
    const result = v2KnowledgeSearchBodySchema.safeParse({
      workspaceId,
      knowledgeBaseIds,
      query: 'a'.repeat(MAX_V2_KNOWLEDGE_SEARCH_QUERY_LENGTH),
    })
    expect(result.success).toBe(true)
  })

  it('rejects a query one character past the maximum, naming the limit', () => {
    const result = v2KnowledgeSearchBodySchema.safeParse({
      workspaceId,
      knowledgeBaseIds,
      query: 'a'.repeat(MAX_V2_KNOWLEDGE_SEARCH_QUERY_LENGTH + 1),
    })
    expect(result.success).toBe(false)
    expect(issueMessages(result)).toContain(
      `query cannot exceed ${MAX_V2_KNOWLEDGE_SEARCH_QUERY_LENGTH} characters`
    )
  })

  it('bounds the query by the embedding model per-input token ceiling', () => {
    expect(MAX_V2_KNOWLEDGE_SEARCH_QUERY_LENGTH).toBe(8192 * 4)
  })

  it('accepts tag filters at the cap', () => {
    const result = v2KnowledgeSearchBodySchema.safeParse({
      workspaceId,
      knowledgeBaseIds,
      tagFilters: tagFilters(MAX_V2_KNOWLEDGE_DOCUMENT_TAG_FILTERS),
    })
    expect(result.success).toBe(true)
  })

  /**
   * The document list has always rejected an eleventh filter. Search shares the
   * tag vocabulary, so it must share the policy — the same request cannot be a
   * 400 on one surface and an applied 200 on the other.
   */
  it('rejects one tag filter past the cap with the same message the document list uses', () => {
    const overLimit = tagFilters(MAX_V2_KNOWLEDGE_DOCUMENT_TAG_FILTERS + 1)
    const expected = `tagFilters cannot contain more than ${MAX_V2_KNOWLEDGE_DOCUMENT_TAG_FILTERS} filters`

    const searchResult = v2KnowledgeSearchBodySchema.safeParse({
      workspaceId,
      knowledgeBaseIds,
      tagFilters: overLimit,
    })
    expect(searchResult.success).toBe(false)
    expect(issueMessages(searchResult)).toContain(expected)

    const listResult = parseV2KnowledgeTagFiltersParam(JSON.stringify(overLimit))
    expect(listResult.success).toBe(false)
    expect(listResult.success === false && listResult.message).toContain(expected)
  })

  it('still accepts an ordinary single filter of each field type', () => {
    const result = v2KnowledgeSearchBodySchema.safeParse({
      workspaceId,
      knowledgeBaseIds,
      query: 'How do I reset my password?',
      tagFilters: [
        { tagName: 'From', operator: 'contains', value: 'brex' },
        { tagName: 'Messages in Thread', operator: 'gte', value: 9 },
        {
          tagName: 'Last Message',
          operator: 'between',
          value: '2026-01-01',
          valueTo: '2026-12-31',
        },
      ],
    })
    expect(result.success).toBe(true)
  })
})
