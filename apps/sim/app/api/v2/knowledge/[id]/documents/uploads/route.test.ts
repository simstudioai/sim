/**
 * @vitest-environment node
 */
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockCreateKnowledgeDocumentUploadSession,
  mockResolveKnowledgeDocumentUploadAccess,
  mockResolveKnowledgeDocumentUploadBilling,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockCreateKnowledgeDocumentUploadSession: vi.fn(),
  mockResolveKnowledgeDocumentUploadAccess: vi.fn(),
  mockResolveKnowledgeDocumentUploadBilling: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({ checkRateLimit: mockCheckRateLimit }))
vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/app/api/v2/knowledge/[id]/documents/uploads/utils', () => ({
  createKnowledgeDocumentUploadSession: mockCreateKnowledgeDocumentUploadSession,
  resolveKnowledgeDocumentUploadAccess: mockResolveKnowledgeDocumentUploadAccess,
  resolveKnowledgeDocumentUploadBilling: mockResolveKnowledgeDocumentUploadBilling,
  toV2KnowledgeDocumentUpload: (session: Record<string, unknown>) => ({
    ...session,
    name: session.fileName,
    contentType: session.contentType,
    size: session.fileSize,
    expiresAt: '2026-08-04T21:00:00.000Z',
    document: null,
  }),
}))

import { POST } from '@/app/api/v2/knowledge/[id]/documents/uploads/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const RATE_LIMIT = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-08-03T22:00:00.000Z'),
}

function request() {
  return POST(
    new NextRequest('http://localhost:3000/api/v2/knowledge/kb-1/documents/uploads', {
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

describe('POST /api/v2/knowledge/[id]/documents/uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT)
    mockResolveKnowledgeDocumentUploadAccess.mockResolvedValue({
      kb: { id: 'kb-1', name: 'Docs' },
    })
    mockResolveKnowledgeDocumentUploadBilling.mockResolvedValue({ actorUserId: 'user-1' })
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

  it('authorizes the knowledge base and runs usage billing before accepting storage', async () => {
    const response = await request()

    expect(response.status).toBe(201)
    expect(mockResolveKnowledgeDocumentUploadAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseId: 'kb-1',
        workspaceId: WORKSPACE_ID,
        userId: 'user-1',
      })
    )
    expect(mockResolveKnowledgeDocumentUploadBilling).toHaveBeenCalled()
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
        billingAttribution: { actorUserId: 'user-1' },
      },
      localOrigin: 'http://localhost:3000',
    })
    expect((await response.json()).data).toMatchObject({
      session: { id: 'upload-1', status: 'uploading', document: null },
      uploadToken: 'token',
      transfer: { method: 'put', url: 'https://storage.example/upload' },
    })
    expect(mockResolveKnowledgeDocumentUploadBilling.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreateKnowledgeDocumentUploadSession.mock.invocationCallOrder[0]
    )
  })

  it('does not run billing or create provider state when knowledge write access is denied', async () => {
    mockResolveKnowledgeDocumentUploadAccess.mockResolvedValue(
      NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Access denied' } }, { status: 403 })
    )

    const response = await request()

    expect(response.status).toBe(403)
    expect(mockResolveKnowledgeDocumentUploadBilling).not.toHaveBeenCalled()
    expect(mockCreateKnowledgeDocumentUploadSession).not.toHaveBeenCalled()
  })
})
