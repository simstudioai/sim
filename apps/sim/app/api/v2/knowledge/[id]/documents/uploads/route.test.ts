/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateV2ApiKey: vi.fn(),
  checkRateLimitDirect: vi.fn(),
  checkRateLimitDirectOrThrow: vi.fn(),
  createUpload: vi.fn(),
  gate: vi.fn(),
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

vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mocks.gate }))

vi.mock('@/app/api/v2/knowledge/[id]/documents/uploads/utils', () => ({
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

import { POST } from '@/app/api/v2/knowledge/[id]/documents/uploads/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const PRINCIPAL = {
  kind: 'workspace_api_key' as const,
  workspaceId: WORKSPACE_ID,
  keyId: 'key-1',
}
const AUTH = {
  principal: PRINCIPAL,
  rolloutUserId: 'billing-owner-1',
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
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
    expiresAt: '2026-01-01T01:00:00.000Z',
  },
}

function request(body: Record<string, unknown>) {
  const request = new NextRequest('http://localhost:3000/api/v2/knowledge/kb-1/documents/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'secret' },
    body: JSON.stringify(body),
  })
  return {
    request,
    response: POST(request, { params: Promise.resolve({ id: 'kb-1' }) }),
  }
}

describe('POST /api/v2/knowledge/[id]/documents/uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticateV2ApiKey.mockResolvedValue(AUTH)
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
    mocks.createUpload.mockResolvedValue(SESSION)
  })

  it('delegates creation with the authenticated principal and asserted workspace', async () => {
    const call = request({
      workspaceId: WORKSPACE_ID,
      name: 'guide.pdf',
      contentType: 'application/pdf',
      size: 1024,
      tag1: 'product',
      processingOptions: { recipe: 'default', lang: 'en' },
    })
    const response = await call.response

    expect(response.status).toBe(201)
    expect(mocks.createUpload).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        knowledgeBaseId: 'kb-1',
        assertedWorkspaceId: WORKSPACE_ID,
        name: 'guide.pdf',
        contentType: 'application/pdf',
        size: 1024,
        metadata: {
          tag1: 'product',
          processingOptions: { recipe: 'default', lang: 'en' },
        },
      },
      request: call.request,
    })
    expect(await response.json()).toMatchObject({
      data: {
        session: { id: 'upload-1', status: 'uploading', document: null },
        uploadToken: 'token',
      },
    })
  })

  it('authenticates and rate limits before parsing an invalid request', async () => {
    const response = await request({ workspaceId: WORKSPACE_ID }).response

    expect(response.status).toBe(400)
    expect(mocks.authenticateV2ApiKey).toHaveBeenCalledTimes(1)
    expect(mocks.checkRateLimitDirectOrThrow).toHaveBeenCalledTimes(2)
    expect(mocks.createUpload).not.toHaveBeenCalled()
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
