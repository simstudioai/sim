import { describe, expect, it } from 'vitest'
import {
  v2CreateKnowledgeBaseContract,
  v2CreateKnowledgeDocumentUploadContract,
  v2CreateKnowledgeFolderContract,
  v2SearchKnowledgeContract,
  v2UploadKnowledgeDocumentContract,
} from '@/lib/api/contracts/v2/knowledge'

describe('v2 knowledge contracts', () => {
  it('declares 201 for every resource-creation response', () => {
    expect(v2CreateKnowledgeBaseContract.response.status).toBe(201)
    expect(v2CreateKnowledgeFolderContract.response.status).toBe(201)
    expect(v2UploadKnowledgeDocumentContract.response.status).toBe(201)
    expect(v2CreateKnowledgeDocumentUploadContract.response.status).toBe(201)
  })

  it('preserves knowledge search bounds', () => {
    const valid = v2SearchKnowledgeContract.body?.safeParse({
      workspaceId: 'workspace-1',
      knowledgeBaseIds: Array.from({ length: 20 }, (_, index) => `kb-${index}`),
      query: 'support',
      topK: 100,
    })
    const tooManyKnowledgeBases = v2SearchKnowledgeContract.body?.safeParse({
      workspaceId: 'workspace-1',
      knowledgeBaseIds: Array.from({ length: 21 }, (_, index) => `kb-${index}`),
      query: 'support',
      topK: 100,
    })
    const excessiveTopK = v2SearchKnowledgeContract.body?.safeParse({
      workspaceId: 'workspace-1',
      knowledgeBaseIds: ['kb-1'],
      query: 'support',
      topK: 101,
    })

    expect(valid?.success).toBe(true)
    expect(tooManyKnowledgeBases?.success).toBe(false)
    expect(excessiveTopK?.success).toBe(false)
  })
})
