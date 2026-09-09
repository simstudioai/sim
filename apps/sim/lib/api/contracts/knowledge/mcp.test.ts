/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  chatSearchMcpSchema,
  readDocumentMcpSchema,
  searchMcpSchema,
} from '@/lib/api/contracts/knowledge/mcp'

describe('Search MCP inputs', () => {
  it('keeps workspace and knowledge-base selection outside the organization tools', () => {
    expect(searchMcpSchema.safeParse({ query: 'notes', workspaceId: 'workspace-1' }).success).toBe(
      false
    )
    expect(searchMcpSchema.safeParse({ query: 'notes', knowledgeBaseIds: ['kb-1'] }).success).toBe(
      false
    )
    expect(
      readDocumentMcpSchema.safeParse({ documentId: 'doc-1', knowledgeBaseId: 'kb-1' }).success
    ).toBe(false)
    expect(
      chatSearchMcpSchema.safeParse({ query: 'notes', conversationId: 'other-chat' }).success
    ).toBe(false)
  })
  it.each([searchMcpSchema, chatSearchMcpSchema])(
    'accepts the shared source and timestamp filters',
    (schema) => {
      expect(
        schema.parse({
          query: 'Jira updates',
          source: 'jira',
          modifiedAfter: '2026-09-07T00:00:00-07:00',
          documentIds: ['doc-1'],
        })
      ).toMatchObject({ source: 'jira', modifiedAfter: '2026-09-07T00:00:00-07:00' })
      for (const invalid of [
        { query: ' ' },
        { query: 'updates', modifiedAfter: 'Monday' },
        { query: 'updates', source: '' },
        { query: 'updates', documentIds: [] },
      ]) {
        expect(schema.safeParse(invalid).success).toBe(false)
      }
    }
  )

  it('requires a single document target and a single pagination strategy', () => {
    for (const invalid of [
      {},
      { documentId: 'doc-1', url: 'https://example.com/doc' },
      { documentId: 'doc-1', offset: 0, aroundChunkIndex: 2 },
      { documentId: 'doc-1', limit: 51 },
      { documentId: 'doc-1', aroundChunkIndex: -1 },
    ]) {
      expect(readDocumentMcpSchema.safeParse(invalid).success).toBe(false)
    }
    expect(readDocumentMcpSchema.parse({ documentId: 'doc-1', aroundChunkIndex: 20 })).toEqual({
      documentId: 'doc-1',
      aroundChunkIndex: 20,
      limit: 20,
    })
    expect(readDocumentMcpSchema.parse({ url: 'https://example.com/doc' })).toEqual({
      url: 'https://example.com/doc',
      limit: 20,
    })
  })

  it.each([
    'not a URL',
    'file:///tmp/doc',
    'javascript:alert(1)',
    'https://user:password@example.com/doc',
  ])('rejects unsafe or malformed document URL %s', (url) => {
    expect(readDocumentMcpSchema.safeParse({ url }).success).toBe(false)
  })
})
