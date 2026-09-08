/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { compactRetrievalCitations } from '@/lib/copilot/chat/retrieval-citations'

describe('persisted retrieval citations', () => {
  it('bounds display evidence and discards the rest of the tool output', () => {
    const result = compactRetrievalCitations('search_workspace', {
      success: true,
      data: {
        results: Array.from({ length: 100 }, (_, i) => ({
          citationId: `document:${i}`,
          citationUrl: 'https://example.test/doc',
          content: 'x'.repeat(4000),
          secret: 'drop',
          documentId: 'drop',
        })),
        private: 'drop',
      },
    })
    const json = JSON.stringify(result)
    expect(json).not.toContain('secret')
    expect(json).not.toContain('private')
    expect(json).not.toContain('documentId')
    expect(json.match(/citationId/g)).toHaveLength(50)
    expect(json).not.toContain('x'.repeat(501))
  })
  it('does not retain failed or unrelated tool data', () => {
    expect(compactRetrievalCitations('call_integration_tool', { token: 'private' })).toBeUndefined()
    expect(
      compactRetrievalCitations('read_document', {
        success: false,
        data: { citationId: 'a', citationUrl: 'https://example.test' },
      })
    ).toBeUndefined()
  })
})
