import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateV2ApiKey: vi.fn(),
  checkRateLimitDirect: vi.fn(),
  checkRateLimitDirectOrThrow: vi.fn(),
  createUpload: vi.fn(),
}))

vi.mock('@/lib/knowledge/application/upload-sessions', () => ({
  createKnowledgeDocumentUpload: {
    operation: {
      id: 'knowledge.documents.upload.create',
      minimumRole: 'write',
      workspaceApiKey: 'allow',
    },
    execute: mocks.createUpload,
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

vi.mock('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/utils', () => ({
  toV2KnowledgeDocumentUpload: (session: Record<string, unknown>) => ({
    id: session.id,
    knowledgeBaseId: session.knowledgeBaseId,
    status: session.status,
    name: session.fileName,
    contentType: session.contentType,
    size: session.fileSize,
    expiresAt: '2026-08-04T21:00:00.000Z',
    error: null,
    document: null,
  }),
}))

import { POST } from '@/app/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const PRINCIPAL = {
  kind: 'workspace_api_key' as const,
  workspaceId: WORKSPACE_ID,
  keyId: 'key-1',
}
const AUTH = {
  principal: PRINCIPAL,
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

function request(body: Record<string, unknown>) {
  const request = new NextRequest('http://localhost:3000/api/v2/knowledge/kb-1/documents/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'secret' },
    body: JSON.stringify(body),
  })
  return {
    request,
    response: POST(request, { params: Promise.resolve({ knowledgeBaseId: 'kb-1' }) }),
  }
}

describe('POST /api/v2/knowledge/[knowledgeBaseId]/documents/uploads', () => {
  beforeEach(() => {
    mocks.authenticateV2ApiKey.mockResolvedValue(AUTH)
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
  })

  it('rejects oversized or server-authored credential-binding body fields', async () => {
    const oversized = await request({
      workspaceId: WORKSPACE_ID,
      name: 'guide.pdf',
      contentType: 'application/pdf',
      size: 100 * 1024 * 1024 + 1,
    }).response
    const forgedBinding = await request({
      workspaceId: WORKSPACE_ID,
      name: 'guide.pdf',
      contentType: 'application/pdf',
      size: 1024,
      authBinding: {
        version: 1,
        workspaceId: WORKSPACE_ID,
        principal: { kind: 'workspace_api_key', workspaceId: WORKSPACE_ID, keyId: 'forged' },
      },
    }).response

    expect(oversized.status).toBe(400)
    expect(forgedBinding.status).toBe(400)
    expect(mocks.createUpload).not.toHaveBeenCalled()
  })
})
