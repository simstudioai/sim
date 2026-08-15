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
  complete: vi.fn(),
  create: vi.fn(),
  gate: vi.fn(),
  parts: vi.fn(),
}))

function operation(id: string) {
  return { id, minimumRole: 'write', workspaceApiKey: 'allow' }
}

vi.mock('@/lib/knowledge/application/upload-sessions', () => ({
  KnowledgeDocumentUnsupportedMediaTypeError: class KnowledgeDocumentUnsupportedMediaTypeError extends Error {},
  createKnowledgeDocumentUpload: {
    operation: operation('knowledge.documents.upload.create'),
    execute: mocks.create,
  },
  cancelKnowledgeDocumentUpload: {
    operation: operation('knowledge.documents.upload.cancel'),
    execute: mocks.cancel,
  },
  issueKnowledgeDocumentUploadParts: {
    operation: operation('knowledge.documents.upload.parts'),
    execute: mocks.parts,
  },
  completeKnowledgeDocumentUpload: {
    operation: operation('knowledge.documents.upload.complete'),
    execute: mocks.complete,
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
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))

import {
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
} from '@/lib/core/application'
import { POST as COMPLETE } from '@/app/api/v2/knowledge/[id]/documents/uploads/[uploadId]/complete/route'
import { POST as PARTS } from '@/app/api/v2/knowledge/[id]/documents/uploads/[uploadId]/parts/route'
import { DELETE as CANCEL } from '@/app/api/v2/knowledge/[id]/documents/uploads/[uploadId]/route'
import { POST as CREATE } from '@/app/api/v2/knowledge/[id]/documents/uploads/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const BASE = `http://localhost:3000/api/v2/knowledge/kb-1/documents/uploads`

function context() {
  return { params: Promise.resolve({ id: 'kb-1', uploadId: 'upload-1' }) }
}

function controlHeaders() {
  return { 'upload-token': 'token', 'x-api-key': 'secret' }
}

/**
 * Each entry pairs the route handler with the mocked use case behind it, so a
 * case can make that one operation refuse and read the status the route
 * renders.
 */
const routes = [
  {
    name: 'create upload session',
    useCase: mocks.create,
    call: () =>
      CREATE(
        new NextRequest(BASE, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
          body: JSON.stringify({
            workspaceId: WORKSPACE_ID,
            name: 'guide.pdf',
            contentType: 'application/pdf',
            size: 1024,
          }),
        }),
        context()
      ),
  },
  {
    name: 'abort upload session',
    useCase: mocks.cancel,
    call: () =>
      CANCEL(
        new NextRequest(`${BASE}/upload-1?workspaceId=${WORKSPACE_ID}`, {
          method: 'DELETE',
          headers: controlHeaders(),
        }),
        context()
      ),
  },
  {
    name: 'issue part urls',
    useCase: mocks.parts,
    call: () =>
      PARTS(
        new NextRequest(`${BASE}/upload-1/parts?workspaceId=${WORKSPACE_ID}`, {
          method: 'POST',
          headers: { ...controlHeaders(), 'content-type': 'application/json' },
          body: JSON.stringify({ partNumbers: [1] }),
        }),
        context()
      ),
  },
  {
    name: 'complete upload session',
    useCase: mocks.complete,
    call: () =>
      COMPLETE(
        new NextRequest(`${BASE}/upload-1/complete?workspaceId=${WORKSPACE_ID}`, {
          method: 'POST',
          headers: controlHeaders(),
        }),
        context()
      ),
  },
] as const

/**
 * The four knowledge upload routes are the only knowledge routes naming a
 * knowledge base whose failures were not concealed, and their ordering made the
 * gap an oracle: the use case resolves the knowledge-base context — which throws
 * `not_found` when the base is absent *or* lives in another workspace — before
 * workspace authorization runs. So an unconcealed 403 meant "this base exists in
 * a workspace you cannot reach" and a 404 meant "it does not exist", while
 * `GET /api/v2/knowledge/{id}` answers 404 to both.
 */
describe('v2 knowledge upload resource concealment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticateV2ApiKey.mockResolvedValue({
      principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' },
      rolloutUserId: 'user-1',
      rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'],
      rateLimitSubscription: null,
      keyType: 'personal',
    })
    mocks.gate.mockResolvedValue(null)
    for (const limiter of [mocks.checkRateLimitDirect, mocks.checkRateLimitDirectOrThrow]) {
      limiter.mockResolvedValue({
        allowed: true,
        remaining: 99,
        resetAt: new Date('2026-08-04T21:00:00.000Z'),
      })
    }
  })

  it.each(routes)(
    '$name reports a cross-tenant refusal as a missing knowledge base',
    async ({ useCase, call }) => {
      useCase.mockRejectedValue(new NoWorkspaceAccessError())

      const response = await call()

      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toEqual({
        error: { code: 'NOT_FOUND', message: 'Knowledge base not found' },
      })
    }
  )

  it.each(routes)(
    '$name still reports a same-workspace role denial as forbidden',
    async ({ useCase, call }) => {
      useCase.mockRejectedValue(new InsufficientWorkspacePermissionsError())

      const response = await call()

      expect(response.status).toBe(403)
    }
  )
})
