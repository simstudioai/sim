/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface UploadClientMockParams<T> {
  complete: () => Promise<T>
}

const { mockRequestJson, mockUploadFileSession } = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
  mockUploadFileSession: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mockRequestJson }))
vi.mock('@/lib/uploads/client/upload-session', () => ({
  uploadFileSession: mockUploadFileSession,
}))

import {
  uploadInternalFileSession,
  uploadKnowledgeDocumentSession,
} from '@/lib/uploads/client/session-upload'

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

describe('session upload domain clients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the PUT knowledge session without requesting part URLs', async () => {
    mockRequestJson
      .mockResolvedValueOnce({
        data: {
          session: { id: 'upload-1' },
          uploadToken: 'token',
          transfer: {
            method: 'put',
            url: 'https://storage.example/upload',
            headers: { 'Content-Type': 'application/pdf' },
          },
        },
      })
      .mockResolvedValueOnce({ data: { document: DOCUMENT } })
    mockUploadFileSession.mockImplementation(
      async (params: UploadClientMockParams<typeof DOCUMENT>) => params.complete()
    )
    const file = { name: 'guide.pdf', type: 'application/pdf', size: 1024 } as File

    await expect(
      uploadKnowledgeDocumentSession({
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        file,
        tag1: 'product',
      })
    ).resolves.toEqual(DOCUMENT)

    expect(mockRequestJson.mock.calls[0][0].path).toBe('/api/knowledge/[id]/documents/uploads')
    expect(mockRequestJson.mock.calls[1][0].path).toBe(
      '/api/knowledge/[id]/documents/uploads/[uploadId]/complete'
    )
    expect(mockRequestJson.mock.calls[1][1].body).toBeUndefined()
    expect(mockRequestJson.mock.calls.some(([contract]) => contract.path.endsWith('/parts'))).toBe(
      false
    )
  })

  it('returns the purpose-specific result from the generic internal session', async () => {
    const result = {
      path: '/api/files/serve/logo.png',
      key: 'workspace-logos/logo.png',
      name: 'logo.png',
      size: 100,
      type: 'image/png',
    }
    mockRequestJson
      .mockResolvedValueOnce({
        data: {
          session: { id: 'upload-2', purpose: 'workspace_logo' },
          uploadToken: 'token',
          transfer: {
            method: 'put',
            url: 'https://storage.example/upload',
            headers: { 'Content-Type': 'image/png' },
          },
        },
      })
      .mockResolvedValueOnce({
        data: { id: 'upload-2', purpose: 'workspace_logo', result },
      })
    mockUploadFileSession.mockImplementation(
      async (params: UploadClientMockParams<typeof result>) => params.complete()
    )

    await expect(
      uploadInternalFileSession({
        purpose: 'workspace_logo',
        workspaceId: 'workspace-1',
        file: { name: 'logo.png', type: 'image/png', size: 100 } as File,
      })
    ).resolves.toEqual(result)

    expect(mockRequestJson.mock.calls[0][1].body).toEqual({
      purpose: 'workspace_logo',
      workspaceId: 'workspace-1',
      name: 'logo.png',
      contentType: 'image/png',
      size: 100,
    })
  })
})
