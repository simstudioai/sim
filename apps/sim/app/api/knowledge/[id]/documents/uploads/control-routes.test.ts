/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  captureServerEvent: vi.fn(),
  complete: vi.fn(),
  parts: vi.fn(),
  platformEvent: vi.fn(),
  requireActor: vi.fn(),
}))

vi.mock('@/lib/knowledge/application/upload-sessions', () => ({
  cancelKnowledgeDocumentUpload: { execute: mocks.cancel },
  completeKnowledgeDocumentUpload: { execute: mocks.complete },
  issueKnowledgeDocumentUploadParts: { execute: mocks.parts },
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { knowledgeBaseDocumentsUploaded: mocks.platformEvent },
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.captureServerEvent }))
vi.mock('@/app/api/knowledge/[id]/documents/uploads/utils', () => ({
  knowledgeDocumentUploadErrorResponse: vi.fn(() => null),
  requireKnowledgeDocumentUploadActor: mocks.requireActor,
}))
vi.mock('@/app/api/v2/knowledge/[id]/documents/uploads/utils', () => ({
  toV2KnowledgeDocumentUpload: (_session: unknown, document: unknown) => ({
    id: 'upload-1',
    knowledgeBaseId: 'kb-1',
    status: document ? 'completed' : 'aborted',
    name: 'guide.pdf',
    contentType: 'application/pdf',
    size: 1024,
    expiresAt: '2026-08-05T00:00:00.000Z',
    error: null,
    document,
  }),
}))

import { POST as COMPLETE } from '@/app/api/knowledge/[id]/documents/uploads/[uploadId]/complete/route'
import { POST as PARTS } from '@/app/api/knowledge/[id]/documents/uploads/[uploadId]/parts/route'
import { DELETE as CANCEL } from '@/app/api/knowledge/[id]/documents/uploads/[uploadId]/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const PRINCIPAL = { kind: 'session', userId: 'user-1', sessionId: 'session-1' }
const SESSION = { id: 'upload-1', knowledgeBaseId: 'kb-1' }
const DOCUMENT = {
  id: 'upload-1',
  knowledgeBaseId: 'kb-1',
  filename: 'guide.pdf',
  fileSize: 1024,
  mimeType: 'application/pdf',
  chunkCount: 0,
  tokenCount: 0,
  characterCount: 0,
  enabled: true,
  uploadedAt: new Date('2026-08-03T21:01:00.000Z'),
}

function routeContext() {
  return { params: Promise.resolve({ id: 'kb-1', uploadId: 'upload-1' }) }
}

function controlUrl(suffix = '') {
  return `http://localhost:3000/api/knowledge/kb-1/documents/uploads/upload-1${suffix}?workspaceId=${WORKSPACE_ID}`
}

describe('internal knowledge-document upload control routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireActor.mockResolvedValue({ id: 'user-1', sessionId: 'session-1' })
    mocks.parts.mockResolvedValue({
      parts: [
        {
          partNumber: 1,
          url: 'https://storage.example/1',
          headers: {},
          expiresAt: '2026-08-04T21:00:00.000Z',
        },
      ],
    })
    mocks.cancel.mockResolvedValue(SESSION)
    mocks.complete.mockResolvedValue({
      session: SESSION,
      value: { document: DOCUMENT, created: true, knowledgeBaseName: 'Docs' },
      alreadyCompleted: false,
      workspaceId: WORKSPACE_ID,
      knowledgeBaseId: 'kb-1',
    })
  })

  it('delegates multipart part signing with the current session principal', async () => {
    const request = new NextRequest(controlUrl('/parts'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'upload-token': 'token' },
      body: JSON.stringify({ partNumbers: [1] }),
    })

    const response = await PARTS(request, routeContext())

    expect(response.status).toBe(200)
    expect(mocks.parts).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        knowledgeBaseId: 'kb-1',
        assertedWorkspaceId: WORKSPACE_ID,
        uploadId: 'upload-1',
        uploadToken: 'token',
        partNumbers: [1],
      },
      request,
    })
  })

  it('delegates cancellation with the current session principal', async () => {
    const request = new NextRequest(controlUrl(), {
      method: 'DELETE',
      headers: { 'upload-token': 'token' },
    })

    const response = await CANCEL(request, routeContext())

    expect(response.status).toBe(200)
    expect(mocks.cancel).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        knowledgeBaseId: 'kb-1',
        assertedWorkspaceId: WORKSPACE_ID,
        uploadId: 'upload-1',
        uploadToken: 'token',
      },
      request,
    })
  })

  it('delegates completion and emits UI analytics only for a new document', async () => {
    const request = new NextRequest(controlUrl('/complete'), {
      method: 'POST',
      headers: { 'upload-token': 'token' },
    })

    const response = await COMPLETE(request, routeContext())

    expect(response.status).toBe(200)
    expect(mocks.complete).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        knowledgeBaseId: 'kb-1',
        assertedWorkspaceId: WORKSPACE_ID,
        uploadId: 'upload-1',
        uploadToken: 'token',
        source: 'ui',
      },
      request,
    })
    expect(mocks.captureServerEvent).toHaveBeenCalledTimes(1)
    expect(mocks.platformEvent).toHaveBeenCalledTimes(1)
  })

  it('does not duplicate UI analytics on an idempotent completion retry', async () => {
    mocks.complete.mockResolvedValue({
      session: SESSION,
      value: { document: DOCUMENT, created: false, knowledgeBaseName: 'Docs' },
      alreadyCompleted: true,
      workspaceId: WORKSPACE_ID,
      knowledgeBaseId: 'kb-1',
    })
    const request = new NextRequest(controlUrl('/complete'), {
      method: 'POST',
      headers: { 'upload-token': 'token' },
    })

    await COMPLETE(request, routeContext())

    expect(mocks.captureServerEvent).not.toHaveBeenCalled()
    expect(mocks.platformEvent).not.toHaveBeenCalled()
  })
})
