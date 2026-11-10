/**
 * @vitest-environment node
 *
 * Failure mode: a search result with no source link of its own links to a Sim document page that
 * does not exist, as an organization's search index has none, so the viewer opens a 404.
 */
import { describe, expect, it } from 'vitest'
import type { WorkspaceKnowledgeSearchResult } from '@/lib/api/contracts/knowledge'
import { toSource } from '@/lib/knowledge/search/results'

const upload: WorkspaceKnowledgeSearchResult = {
  documentId: 'doc-1',
  knowledgeBaseId: 'kb-1',
  knowledgeBaseName: 'Uploads',
  documentName: 'Plan.pdf',
  sourceUrl: null,
  connectorType: null,
  sourceModifiedAt: null,
  author: null,
  content: 'The plan',
  chunkIndex: 0,
  similarity: 1,
}

describe('toSource', () => {
  it('gives an organization upload no link, since it has no document page', () => {
    expect(
      toSource(upload, 'plan', { kind: 'organization', organizationId: 'org-1' }).url
    ).toBeUndefined()
  })
})
