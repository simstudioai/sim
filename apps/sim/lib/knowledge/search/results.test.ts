/**
 * @vitest-environment node
 *
 * Failure mode: a cited Sim document link that `knowledgeDocumentLink` cannot read back, so a
 * citation of a deleted document still renders as a dead link; or a provider's own link read as a
 * Sim document, so a live source is checked against the wrong record and hidden.
 */

import { describe, expect, it } from 'vitest'
import type { WorkspaceKnowledgeSearchResult } from '@/lib/api/contracts/mothership-assistant-tools'
import { toSource } from '@/lib/knowledge/search/results'
import { knowledgeDocumentLink } from '@/lib/knowledge/search/source-url'

function result(
  overrides: Partial<WorkspaceKnowledgeSearchResult>
): WorkspaceKnowledgeSearchResult {
  return {
    documentId: 'doc/1',
    knowledgeBaseId: 'kb 1',
    knowledgeBaseName: 'Uploads',
    documentName: 'Plan.pdf',
    sourceUrl: null,
    connectorType: null,
    sourceModifiedAt: null,
    author: null,
    content: 'The plan',
    chunkIndex: 0,
    similarity: 1,
    ...overrides,
  }
}

describe('knowledgeDocumentLink', () => {
  it.each([
    { kind: 'organization' as const, organizationId: 'org 1' },
    { kind: 'workspace' as const, workspaceId: 'ws-1' },
  ])('reads back the Sim link a $kind citation was given', (scope) => {
    const { url } = toSource(result({}), 'plan', scope)
    expect(knowledgeDocumentLink(url)).toEqual({ knowledgeBaseId: 'kb 1', documentId: 'doc/1' })
  })

  it('reads no document from a provider link or another site', () => {
    const provider = toSource(
      result({ sourceUrl: 'https://docs.example.com/workspace/x/knowledge/kb/doc' }),
      'plan',
      { kind: 'workspace', workspaceId: 'ws-1' }
    )
    expect(knowledgeDocumentLink(provider.url)).toBeNull()
    expect(knowledgeDocumentLink('not a url')).toBeNull()
  })
})
