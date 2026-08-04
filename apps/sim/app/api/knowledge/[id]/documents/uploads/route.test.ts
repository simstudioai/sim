/**
 * @vitest-environment node
 */
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCreateKnowledgeDocumentUploadSession,
  mockRequireKnowledgeDocumentUploadAccess,
  mockRequireKnowledgeDocumentUploadActor,
  mockRequireKnowledgeDocumentUploadBilling,
} = vi.hoisted(() => ({
  mockCreateKnowledgeDocumentUploadSession: vi.fn(),
  mockRequireKnowledgeDocumentUploadAccess: vi.fn(),
  mockRequireKnowledgeDocumentUploadActor: vi.fn(),
  mockRequireKnowledgeDocumentUploadBilling: vi.fn(),
}))

vi.mock('@/app/api/knowledge/[id]/documents/uploads/utils', () => ({
  requireKnowledgeDocumentUploadAccess: mockRequireKnowledgeDocumentUploadAccess,
  requireKnowledgeDocumentUploadActor: mockRequireKnowledgeDocumentUploadActor,
  requireKnowledgeDocumentUploadBilling: mockRequireKnowledgeDocumentUploadBilling,
}))
vi.mock('@/app/api/files/uploads/utils', () => ({ uploadSessionErrorResponse: vi.fn() }))
vi.mock('@/app/api/v2/knowledge/[id]/documents/uploads/utils', () => ({
  createKnowledgeDocumentUploadSession: mockCreateKnowledgeDocumentUploadSession,
  toV2KnowledgeDocumentUpload: (session: Record<string, unknown>) => ({
    ...session,
    name: session.fileName,
    contentType: session.contentType,
    size: session.fileSize,
    expiresAt: '2026-08-05T00:00:00.000Z',
    document: null,
  }),
}))

import { POST } from '@/app/api/knowledge/[id]/documents/uploads/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'

function request() {
  return POST(
    new NextRequest('http://localhost:3000/api/knowledge/kb-1/documents/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        name: 'guide.pdf',
        contentType: 'application/pdf',
        size: 1024,
        tag1: 'product',
        processingOptions: { recipe: 'default', lang: 'en' },
      }),
    }),
    { params: Promise.resolve({ id: 'kb-1' }) }
  )
}

describe('POST /api/knowledge/[id]/documents/uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireKnowledgeDocumentUploadActor.mockResolvedValue({ id: 'user-1' })
    mockRequireKnowledgeDocumentUploadAccess.mockResolvedValue({
      knowledgeBase: { id: 'kb-1', name: 'Docs', workspaceId: WORKSPACE_ID },
    })
    mockRequireKnowledgeDocumentUploadBilling.mockResolvedValue({ actorUserId: 'user-1' })
    mockCreateKnowledgeDocumentUploadSession.mockResolvedValue({
      id: 'upload-1',
      knowledgeBaseId: 'kb-1',
      status: 'uploading',
      fileName: 'guide.pdf',
      contentType: 'application/pdf',
      fileSize: 1024,
      uploadToken: 'token',
      error: null,
      transfer: {
        method: 'put',
        url: 'https://storage.example/upload',
        headers: { 'content-type': 'application/pdf' },
      },
    })
  })

  it('authorizes and bills before allocating a first-party upload session', async () => {
    const response = await request()

    expect(response.status).toBe(201)
    expect(mockRequireKnowledgeDocumentUploadAccess).toHaveBeenCalledWith({
      knowledgeBaseId: 'kb-1',
      workspaceId: WORKSPACE_ID,
      userId: 'user-1',
    })
    expect(mockCreateKnowledgeDocumentUploadSession).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      userId: 'user-1',
      knowledgeBaseId: 'kb-1',
      fileName: 'guide.pdf',
      contentType: 'application/pdf',
      fileSize: 1024,
      metadata: {
        tag1: 'product',
        processingOptions: { recipe: 'default', lang: 'en' },
      },
      localOrigin: 'http://localhost:3000',
    })
    expect((await response.json()).data).toMatchObject({
      session: { id: 'upload-1', status: 'uploading', document: null },
      uploadToken: 'token',
      transfer: { method: 'put', url: 'https://storage.example/upload' },
    })
    expect(mockRequireKnowledgeDocumentUploadBilling.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreateKnowledgeDocumentUploadSession.mock.invocationCallOrder[0]
    )
  })

  it('does not bill or allocate storage when write access is denied', async () => {
    mockRequireKnowledgeDocumentUploadAccess.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    )

    const response = await request()

    expect(response.status).toBe(403)
    expect(mockRequireKnowledgeDocumentUploadBilling).not.toHaveBeenCalled()
    expect(mockCreateKnowledgeDocumentUploadSession).not.toHaveBeenCalled()
  })
})
