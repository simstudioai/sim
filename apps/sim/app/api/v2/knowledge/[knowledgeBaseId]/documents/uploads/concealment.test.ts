import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import {
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing/mocks/v2-route.mock'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  complete: vi.fn(),
  create: vi.fn(),
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

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)

vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { POST as COMPLETE } from '@/app/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/[uploadId]/complete/route'
import { POST as PARTS } from '@/app/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/[uploadId]/parts/route'
import { DELETE as CANCEL } from '@/app/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/[uploadId]/route'
import { POST as CREATE } from '@/app/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const BASE = `http://localhost:3000/api/v2/knowledge/kb-1/documents/uploads`

function context() {
  return createRouteContext({ knowledgeBaseId: 'kb-1', uploadId: 'upload-1' })
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
        createMockRequest({
          method: 'POST',
          url: `${BASE}/upload-1/parts?workspaceId=${WORKSPACE_ID}`,
          headers: { ...controlHeaders() },
          body: { partNumbers: [1] },
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
 * `GET /api/v2/knowledge/{knowledgeBaseId}` answers 404 to both.
 */
describe('v2 knowledge upload resource concealment', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue({
      principal: createPersonalApiKeyPrincipal(),
      rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'],
      rateLimitSubscription: null,
      keyType: 'personal',
    })
    for (const limiter of [v2RouteMocks.preauthRate, v2RouteMocks.operationRate]) {
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
})
