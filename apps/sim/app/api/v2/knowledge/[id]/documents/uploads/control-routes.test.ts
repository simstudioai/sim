/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateV2ApiKey: vi.fn(),
  cancel: vi.fn(),
  checkRateLimitDirect: vi.fn(),
  checkRateLimitDirectOrThrow: vi.fn(),
  gate: vi.fn(),
  parts: vi.fn(),
}))

vi.mock('@/lib/knowledge/application/upload-sessions', () => ({
  cancelKnowledgeDocumentUpload: {
    operation: {
      id: 'knowledge.documents.upload.cancel',
      minimumRole: 'write',
      workspaceApiKey: 'allow',
    },
    execute: mocks.cancel,
  },
  issueKnowledgeDocumentUploadParts: {
    operation: {
      id: 'knowledge.documents.upload.parts',
      minimumRole: 'write',
      workspaceApiKey: 'allow',
    },
    execute: mocks.parts,
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

vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mocks.gate }))
vi.mock('@/app/api/v2/knowledge/[id]/documents/uploads/utils', () => ({
  toV2KnowledgeDocumentUpload: () => ({
    id: 'upload-1',
    knowledgeBaseId: 'kb-1',
    status: 'aborted',
    name: 'guide.pdf',
    contentType: 'application/pdf',
    size: 1024,
    expiresAt: '2026-08-04T21:00:00.000Z',
    error: null,
    document: null,
  }),
}))

import { POST as PARTS } from '@/app/api/v2/knowledge/[id]/documents/uploads/[uploadId]/parts/route'
import { DELETE as CANCEL } from '@/app/api/v2/knowledge/[id]/documents/uploads/[uploadId]/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const PRINCIPAL = {
  kind: 'personal_api_key' as const,
  userId: 'user-1',
  keyId: 'key-1',
}

function context() {
  return { params: Promise.resolve({ id: 'kb-1', uploadId: 'upload-1' }) }
}

function controlUrl(suffix = '') {
  return `http://localhost:3000/api/v2/knowledge/kb-1/documents/uploads/upload-1${suffix}?workspaceId=${WORKSPACE_ID}`
}

describe('v2 knowledge-document upload control routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticateV2ApiKey.mockResolvedValue({
      principal: PRINCIPAL,
      rolloutUserId: 'user-1',
      rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'],
      rateLimitSubscription: null,
      keyType: 'personal',
    })
    mocks.gate.mockResolvedValue(null)
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
    mocks.cancel.mockResolvedValue({ id: 'upload-1' })
  })

  it('delegates part signing with the authenticated API-key principal', async () => {
    const request = new NextRequest(controlUrl('/parts'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'upload-token': 'token',
        'x-api-key': 'secret',
      },
      body: JSON.stringify({ partNumbers: [1] }),
    })

    const response = await PARTS(request, context())

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

  it('delegates cancellation with the authenticated API-key principal', async () => {
    const request = new NextRequest(controlUrl(), {
      method: 'DELETE',
      headers: { 'upload-token': 'token', 'x-api-key': 'secret' },
    })

    const response = await CANCEL(request, context())

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
})
