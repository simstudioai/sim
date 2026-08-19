import { describe, expect, it } from 'vitest'
import { internalKnowledgeSearchBodySchema } from '@/lib/api/contracts/knowledge/search'
import { RESOLVED_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'

describe('internal Knowledge search contract', () => {
  it.each([
    ['display name', { tagName: 'category' }],
    ['definition ID', { tagId: 'tag-definition-id' }],
  ])('accepts a tag filter addressed by %s', (_label, identifier) => {
    expect(
      internalKnowledgeSearchBodySchema.parse({
        knowledgeBaseIds: ['knowledge-base-1'],
        tagFilters: [{ ...identifier, operator: 'eq', value: 'docs' }],
      }).tagFilters
    ).toEqual([{ ...identifier, operator: 'eq', value: 'docs' }])
  })

  it.each([
    ['both identifiers', { tagName: 'category', tagId: 'tag-definition-id' }],
    ['neither identifier', {}],
  ])('rejects a tag filter with %s', (_label, identifier) => {
    const parsed = internalKnowledgeSearchBodySchema.safeParse({
      knowledgeBaseIds: ['knowledge-base-1'],
      tagFilters: [{ ...identifier, operator: 'eq', value: 'docs' }],
    })

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Each tag filter must include exactly one of tagName or tagId',
          }),
        ])
      )
    }
  })

  it.each(['tagName', 'tagId'] as const)('rejects a whitespace-only %s', (identifier) => {
    const parsed = internalKnowledgeSearchBodySchema.safeParse({
      knowledgeBaseIds: ['knowledge-base-1'],
      tagFilters: [{ [identifier]: '   ', operator: 'eq', value: 'docs' }],
    })

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: ['tagFilters', 0, identifier] })])
      )
    }
  })

  it('retains the private model-input provenance envelope for boundary validation', () => {
    const provenance = {
      version: 1 as const,
      complete: true,
      entries: [{ name: 'QUERY_SECRET', encryptedValue: 'encrypted-query-secret' }],
      scope: { userId: 'workflow-owner', workspaceId: 'workspace-1' },
    }

    expect(
      internalKnowledgeSearchBodySchema.parse({
        knowledgeBaseIds: ['knowledge-base-1'],
        query: 'search query',
        [RESOLVED_SECRET_PROVENANCE_FIELD]: provenance,
      })
    ).toMatchObject({ [RESOLVED_SECRET_PROVENANCE_FIELD]: provenance })
  })
})
