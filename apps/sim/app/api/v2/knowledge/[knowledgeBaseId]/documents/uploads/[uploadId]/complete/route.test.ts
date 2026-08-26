/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateV2ApiKey: vi.fn(),
  captureServerEvent: vi.fn(),
  checkRateLimitDirect: vi.fn(),
  checkRateLimitDirectOrThrow: vi.fn(),
  completeUpload: vi.fn(),
  platformEvent: vi.fn(),
}))

vi.mock('@/lib/knowledge/application/upload-sessions', () => ({
  completeKnowledgeDocumentUpload: {
    operation: {
      id: 'knowledge.documents.upload.complete',
      minimumRole: 'write',
      workspaceApiKey: 'allow',
    },
    execute: mocks.completeUpload,
  },
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticateV2ApiKey,
  V2ApiKeyUnauthenticatedError: class V2ApiKeyUnauthenticatedError extends Error {},
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  getRateLimit: () => ({ maxTokens: 100, refillRate: 50, refillIntervalMs: 60_000 }),
  RateLimiter: class RateLimiter {
    checkRateLimitDirect = mocks.checkRateLimitDirect
    checkRateLimitDirectOrThrow = mocks.checkRateLimitDirectOrThrow
  },
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { knowledgeBaseDocumentsUploaded: mocks.platformEvent },
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.captureServerEvent }))
vi.mock('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/utils', () => ({
  toV2KnowledgeDocumentUpload: (_session: unknown, document: { id: string } | null) => ({
    id: 'upload-1',
    knowledgeBaseId: 'kb-1',
    status: 'completed',
    name: 'guide.pdf',
    contentType: 'application/pdf',
    size: 1024,
    expiresAt: '2026-08-04T21:00:00.000Z',
    error: null,
    document: document
      ? {
          id: document.id,
          knowledgeBaseId: 'kb-1',
          filename: 'guide.pdf',
          fileSize: 1024,
          mimeType: 'application/pdf',
          processingStatus: 'pending',
          chunkCount: 0,
          tokenCount: 0,
          characterCount: 0,
          enabled: true,
          createdAt: '2026-08-03T21:01:00.000Z',
        }
      : null,
  }),
}))

import { POST } from '@/app/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/[uploadId]/complete/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
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
const RESULT = {
  session: { id: 'upload-1' },
  value: { document: DOCUMENT, created: true, knowledgeBaseName: 'Docs' },
  alreadyCompleted: false,
  workspaceId: WORKSPACE_ID,
  knowledgeBaseId: 'kb-1',
}

function auth(principal: Record<string, unknown>) {
  return {
    principal,
    rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'] as const,
    rateLimitSubscription: null,
    keyType:
      principal.kind === 'workspace_api_key' ? ('workspace' as const) : ('personal' as const),
  }
}

function request() {
  const request = new NextRequest(
    `http://localhost:3000/api/v2/knowledge/kb-1/documents/uploads/upload-1/complete?workspaceId=${WORKSPACE_ID}`,
    { method: 'POST', headers: { 'upload-token': 'token', 'x-api-key': 'secret' } }
  )
  return {
    request,
    response: POST(request, {
      params: Promise.resolve({ knowledgeBaseId: 'kb-1', uploadId: 'upload-1' }),
    }),
  }
}

describe('POST knowledge-document upload completion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticateV2ApiKey.mockResolvedValue(
      auth({ kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' })
    )
    mocks.checkRateLimitDirect.mockResolvedValue({
      allowed: true,
      remaining: 599,
      resetAt: new Date('2026-08-04T21:00:00.000Z'),
    })
    mocks.checkRateLimitDirectOrThrow.mockResolvedValue({
      allowed: true,
      remaining: 99,
      resetAt: new Date('2026-08-04T21:00:00.000Z'),
    })
    mocks.completeUpload.mockResolvedValue(RESULT)
  })

  it('delegates completion and emits v2 analytics only for a newly created document', async () => {
    const call = request()
    const response = await call.response

    expect(response.status).toBe(200)
    expect(mocks.completeUpload).toHaveBeenCalledWith({
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      input: {
        knowledgeBaseId: 'kb-1',
        assertedWorkspaceId: WORKSPACE_ID,
        uploadId: 'upload-1',
        uploadToken: 'token',
        source: 'api',
      },
      request: call.request,
    })
    expect(mocks.captureServerEvent).toHaveBeenCalledWith(
      'user-1',
      'knowledge_base_document_uploaded',
      expect.objectContaining({ knowledge_base_id: 'kb-1', workspace_id: WORKSPACE_ID }),
      expect.any(Object)
    )
    expect(mocks.platformEvent).toHaveBeenCalledTimes(1)
    expect(await response.json()).toMatchObject({ data: { document: { id: 'upload-1' } } })
  })

  it('does not duplicate analytics for an idempotent completion retry', async () => {
    mocks.completeUpload.mockResolvedValue({
      ...RESULT,
      value: { ...RESULT.value, created: false },
      alreadyCompleted: true,
    })

    const response = await request().response

    expect(response.status).toBe(200)
    expect(mocks.captureServerEvent).not.toHaveBeenCalled()
    expect(mocks.platformEvent).not.toHaveBeenCalled()
  })

  it('does not attribute a workspace-key event to the billing owner', async () => {
    mocks.authenticateV2ApiKey.mockResolvedValue(
      auth({ kind: 'workspace_api_key', workspaceId: WORKSPACE_ID, keyId: 'key-1' })
    )

    await request().response

    expect(mocks.captureServerEvent).not.toHaveBeenCalled()
    expect(mocks.platformEvent).toHaveBeenCalledTimes(1)
  })
})
