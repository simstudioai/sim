/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import type { KnowledgeSearchItem } from '@/lib/knowledge/application/search'
import { renderSlackSearchResults } from '@/lib/slack-search/messages'

const message = {
  appId: 'A1',
  teamId: 'T1',
  eventId: 'Ev1',
  channelId: 'D1',
  userId: 'U1',
  query: 'release notes',
  queryTooLong: false,
}
function result(id: string, overrides: Partial<KnowledgeSearchItem> = {}): KnowledgeSearchItem {
  return {
    embeddingId: 'e1',
    knowledgeBaseId: 'kb1',
    documentId: id,
    documentName: `Document ${id}`,
    sourceUrl: null,
    sourceModifiedAt: null,
    connectorType: null,
    content: 'snippet',
    chunkIndex: 0,
    metadata: {},
    similarity: 1,
    ...overrides,
  }
}

describe('Slack Search result presentation', () => {
  it('keeps rank order, the first chunk per document, and at most five documents', () => {
    const reply = renderSlackSearchResults(
      message,
      'org1',
      [
        result('1', { content: 'best chunk' }),
        result('1', { content: 'other chunk' }),
        ...['2', '3', '4', '5', '6'].map((id) => result(id)),
      ],
      'https://sim.test'
    )
    const serialized = JSON.stringify(reply)
    expect(reply.blocks).toHaveLength(7)
    expect(serialized).toContain('best chunk')
    expect(serialized).not.toContain('other chunk')
    expect(serialized).not.toContain('Document 6')
    expect(reply).toMatchObject({ channel: 'D1', unfurl_links: false, unfurl_media: false })
    expect(serialized).toContain('/o/org1/search?q=release+notes')
  })
  it('renders untrusted text as plain text and only uses valid source URLs', () => {
    const reply = renderSlackSearchResults(
      { ...message, threadTs: '1.2' },
      'org1',
      [
        result('1', {
          documentName: '<!channel> *hi*',
          sourceUrl: 'javascript:alert(1)',
          content: 'x'.repeat(500),
        }),
      ],
      'https://sim.test'
    )
    expect(reply.thread_ts).toBe('1.2')
    expect(reply.blocks?.[1]).toMatchObject({
      text: { type: 'plain_text' },
      accessory: { url: 'https://sim.test/o/org1/knowledge/kb1/1' },
    })
    expect(JSON.stringify(reply)).not.toContain('javascript:')
    expect(JSON.stringify(reply)).not.toContain('x'.repeat(301))
  })
  it('returns an explicit empty-result response', () => {
    expect(renderSlackSearchResults(message, 'org1', [], 'https://sim.test').text).toContain(
      'No results'
    )
  })
  it('keeps Unicode queries and long provider URLs within Slack button limits', () => {
    const reply = renderSlackSearchResults(
      { ...message, query: '界'.repeat(2000) },
      'org1',
      [result('1', { sourceUrl: `https://example.com/${'x'.repeat(3000)}` })],
      'https://sim.test'
    )
    expect(reply.blocks?.[1]).toMatchObject({
      accessory: { url: 'https://sim.test/o/org1/knowledge/kb1/1' },
    })
    expect(reply.blocks?.[2]).toMatchObject({
      elements: [{ url: 'https://sim.test/o/org1/search' }],
    })
  })
})
