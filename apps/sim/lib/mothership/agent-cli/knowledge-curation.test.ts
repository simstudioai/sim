import { describe, expect, it } from 'vitest'
import { curateKnowledgeDocuments } from '@/lib/mothership/agent-cli/knowledge-curation'

const doc = {
  id: 'doc',
  knowledgeBaseId: 'kb',
  filename: 'policy.md',
  fileSize: 42,
  mimeType: 'text/markdown',
  processingStatus: 'failed',
  chunkCount: 0,
  tokenCount: 0,
  characterCount: 0,
  enabled: true,
  createdAt: '2026-09-16T00:00:00Z',
  tags: {},
}
const result = (data: unknown) => ({ exitCode: 0, stdout: JSON.stringify(data), stderr: '' })
describe('knowledge document discovery', () => {
  it('provides an exact original read reference even when indexing failed', () => {
    const response = curateKnowledgeDocuments(result({ data: [doc], nextCursor: null }))
    expect(JSON.parse(response.stdout)).toMatchObject({
      data: [
        {
          id: 'doc',
          indexReady: false,
          original: { readReference: 'knowledge/kb/doc', availability: 'not_checked' },
        },
      ],
      nextCursor: null,
    })
  })
  it('does not confuse completed indexing with proof of source availability', () => {
    const response = curateKnowledgeDocuments(
      result({ data: [{ ...doc, processingStatus: 'completed' }], nextCursor: 'next' })
    )
    expect(JSON.parse(response.stdout)).toMatchObject({
      data: [{ indexReady: true, original: { availability: 'not_checked' } }],
      nextCursor: 'next',
    })
  })
  it('adds the same descriptor to a native document get result', () => {
    const response = curateKnowledgeDocuments(
      result({
        ...doc,
        processingError: 'index failed',
        processingStartedAt: null,
        processingCompletedAt: null,
        connectorId: null,
        connectorType: null,
        sourceUrl: null,
      })
    )
    expect(JSON.parse(response.stdout)).toMatchObject({
      original: { readReference: 'knowledge/kb/doc', availability: 'not_checked' },
      processingStatus: 'failed',
    })
  })
})
