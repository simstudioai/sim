import { describe, expect, it } from 'vitest'
import { internalKnowledgeSearchBodySchema } from '@/lib/api/contracts/knowledge/search'
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
