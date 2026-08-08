/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createUpload: vi.fn(),
  requireActor: vi.fn(),
}))

vi.mock('@/lib/knowledge/application/upload-sessions', () => ({
  createKnowledgeDocumentUpload: { execute: mocks.createUpload },
}))

vi.mock('@/app/api/knowledge/[id]/documents/uploads/utils', () => ({
  knowledgeDocumentUploadErrorResponse: vi.fn(() => null),
  requireKnowledgeDocumentUploadActor: mocks.requireActor,
}))

vi.mock('@/app/api/v2/knowledge/[id]/documents/uploads/utils', () => ({
  toV2KnowledgeDocumentUpload: (session: Record<string, unknown>) => ({
    id: session.id,
    knowledgeBaseId: session.knowledgeBaseId,
    status: session.status,
    name: session.fileName,
    contentType: session.contentType,
    size: session.fileSize,
    expiresAt: '2026-08-05T00:00:00.000Z',
    error: null,
    document: null,
  }),
}))

import { POST } from '@/app/api/knowledge/[id]/documents/uploads/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const SESSION = {
  id: 'upload-1',
  knowledgeBaseId: 'kb-1',
  status: 'uploading',
  fileName: 'guide.pdf',
  contentType: 'application/pdf',
  fileSize: 1024,
  uploadToken: 'token',
  transfer: {
    method: 'put' as const,
    url: 'https://storage.example/upload',
    headers: { 'content-type': 'application/pdf' },
  },
}

function request() {
  const request = new NextRequest('http://localhost:3000/api/knowledge/kb-1/documents/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspaceId: WORKSPACE_ID,
      name: 'guide.pdf',
      contentType: 'application/pdf',
      size: 1024,
      tag1: 'product',
    }),
  })
  return {
    request,
    response: POST(request, { params: Promise.resolve({ id: 'kb-1' }) }),
  }
}

describe('POST /api/knowledge/[id]/documents/uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireActor.mockResolvedValue({
      id: 'user-1',
      sessionId: 'session-1',
      name: 'User',
      email: 'user@example.com',
    })
    mocks.createUpload.mockResolvedValue(SESSION)
  })

  it('constructs a server-authored session principal and delegates creation', async () => {
    const call = request()
    const response = await call.response

    expect(response.status).toBe(201)
    expect(mocks.createUpload).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        knowledgeBaseId: 'kb-1',
        assertedWorkspaceId: WORKSPACE_ID,
        name: 'guide.pdf',
        contentType: 'application/pdf',
        size: 1024,
        metadata: { tag1: 'product' },
      },
      request: call.request,
    })
    expect(await response.json()).toMatchObject({
      data: { session: { id: 'upload-1' }, uploadToken: 'token' },
    })
  })
})
