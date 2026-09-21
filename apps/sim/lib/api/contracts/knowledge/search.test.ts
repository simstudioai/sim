import { describe, expect, it } from 'vitest'
import {
  internalKnowledgeSearchBodySchema,
  workspaceKnowledgeSearchBodySchema,
  workspaceSearchFiltersSchema,
} from '@/lib/api/contracts/knowledge/search'
import { RESOLVED_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'

describe('internal Knowledge search contract', () => {
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

describe('workspaceKnowledgeSearchBodySchema', () => {
  it('refuses a custom window whose end precedes its start, on the request rather than the filters', () => {
    const parsed = workspaceKnowledgeSearchBodySchema.safeParse({
      workspaceId: 'workspace-1',
      query: 'launch',
      filters: {
        modifiedAfter: '2026-09-10T00:00:00.000Z',
        modifiedBefore: '2026-09-01T00:00:00.000Z',
      },
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toEqual(['filters', 'modifiedBefore'])
    }
    /** The filters schema stays a plain object, so the Assistant's search input can still extend it. */
    expect(typeof workspaceSearchFiltersSchema.extend).toBe('function')
  })
})
