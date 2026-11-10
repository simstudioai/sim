/**
 * @vitest-environment node
 *
 * Failure modes: a search result with no source link of its own links to a Sim document page that
 * does not exist, as an organization's search index has none, so the viewer opens a 404; a cited
 * Sim document link that `knowledgeDocumentLink` cannot read back, so a citation of a deleted
 * document still renders as a dead link; or a provider's own link read as a Sim document, so a
 * live source is checked against the wrong record and hidden.
 */

import { describe, expect, it } from 'vitest'
import type { WorkspaceKnowledgeSearchResult } from '@/lib/api/contracts/knowledge'
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

describe('toSource', () => {
  it('gives an organization upload no link, since it has no document page', () => {
    expect(
      toSource(result({}), 'plan', { kind: 'organization', organizationId: 'org-1' }).url
    ).toBeUndefined()
  })
})

describe('knowledgeDocumentLink', () => {
  it('reads back the Sim link a workspace citation was given', () => {
    const { url } = toSource(result({}), 'plan', { kind: 'workspace', workspaceId: 'ws-1' })
    expect(url && knowledgeDocumentLink(url)).toEqual({
      knowledgeBaseId: 'kb 1',
      documentId: 'doc/1',
    })
  })

  it('reads no document from a provider link or another site', () => {
    const provider = toSource(
      result({ sourceUrl: 'https://docs.example.com/workspace/x/knowledge/kb/doc' }),
      'plan',
      { kind: 'workspace', workspaceId: 'ws-1' }
    )
    expect(provider.url && knowledgeDocumentLink(provider.url)).toBeNull()
    expect(knowledgeDocumentLink('not a url')).toBeNull()
  })
})
