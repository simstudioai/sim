/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { V2CompletedPart, V2UploadPartUrl } from '@/lib/api/contracts/v2/uploads'

interface MultipartMockParams<T> {
  getPartUrls: (partNumbers: number[]) => Promise<V2UploadPartUrl[]>
  complete: (parts: V2CompletedPart[]) => Promise<T>
}

const { mockRequestJson, mockUploadMultipartSession } = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
  mockUploadMultipartSession: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mockRequestJson }))
vi.mock('@/lib/uploads/client/multipart-session', () => ({
  uploadMultipartSession: mockUploadMultipartSession,
}))

import { uploadKnowledgeDocumentSession } from '@/lib/uploads/client/session-upload'

const DOCUMENT = {
  id: 'upload-1',
  knowledgeBaseId: 'kb-1',
  filename: 'guide.pdf',
  fileSize: 1024,
  mimeType: 'application/pdf',
  processingStatus: 'pending',
  chunkCount: 0,
  tokenCount: 0,
  characterCount: 0,
  enabled: true,
  createdAt: '2026-08-04T21:00:00.000Z',
} as const

describe('uploadKnowledgeDocumentSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequestJson
      .mockResolvedValueOnce({
        data: {
          id: 'upload-1',
          partSize: 8 * 1024 * 1024,
          partCount: 1,
          uploadToken: 'token',
        },
      })
      .mockResolvedValueOnce({
        data: { parts: [{ partNumber: 1, url: 'https://storage.example/part-1', headers: {} }] },
      })
      .mockResolvedValueOnce({ data: { document: DOCUMENT } })
    mockUploadMultipartSession.mockImplementation(
      async (params: MultipartMockParams<typeof DOCUMENT>) => {
        await params.getPartUrls([1])
        return params.complete([{ partNumber: 1, etag: 'etag-1' }])
      }
    )
  })

  it('uses the first-party session routes and preserves signed processing metadata', async () => {
    const file = {
      name: 'guide.pdf',
      type: 'application/pdf',
      size: 1024,
    } as File

    await expect(
      uploadKnowledgeDocumentSession({
        workspaceId: '6fc7631d-88cd-46f8-9f0a-d4764daef7f8',
        knowledgeBaseId: 'kb-1',
        file,
        tag1: 'product',
        processingOptions: { recipe: 'default', lang: 'en' },
      })
    ).resolves.toEqual(DOCUMENT)

    expect(mockRequestJson.mock.calls[0][0].path).toBe('/api/knowledge/[id]/documents/uploads')
    expect(mockRequestJson.mock.calls[0][1].body).toMatchObject({
      name: 'guide.pdf',
      contentType: 'application/pdf',
      size: 1024,
      tag1: 'product',
      processingOptions: { recipe: 'default', lang: 'en' },
    })
    expect(mockRequestJson.mock.calls[1][0].path).toBe(
      '/api/knowledge/[id]/documents/uploads/[uploadId]/parts'
    )
    expect(mockRequestJson.mock.calls[2][0].path).toBe(
      '/api/knowledge/[id]/documents/uploads/[uploadId]/complete'
    )
  })
})
