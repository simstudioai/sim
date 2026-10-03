import {
  createPersonalApiKeyPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { getMockPlatformEvent, telemetryMock } from '@sim/testing/mocks/telemetry.mock'
import {
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing/mocks/v2-route.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  completeUpload: vi.fn(),
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

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)

vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/core/telemetry', () => telemetryMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { POST } from '@/app/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/[uploadId]/complete/route'

const mockDocumentsUploaded = getMockPlatformEvent('knowledgeBaseDocumentsUploaded')

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
/** The session as the completion use case hands it back, in storage shape. */
const SESSION = {
  id: 'upload-1',
  knowledgeBaseId: 'kb-1',
  status: 'completed',
  fileName: 'guide.pdf',
  contentType: 'application/pdf',
  fileSize: 1024,
  expiresAt: new Date('2026-08-04T21:00:00.000Z'),
  error: null,
}
const RESULT = {
  session: SESSION,
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
  const request = createMockRequest({
    method: 'POST',
    url: `http://localhost:3000/api/v2/knowledge/kb-1/documents/uploads/upload-1/complete?workspaceId=${WORKSPACE_ID}`,
    headers: { 'upload-token': 'token', 'x-api-key': 'secret' },
  })
  return {
    request,
    response: POST(request, createRouteContext({ knowledgeBaseId: 'kb-1', uploadId: 'upload-1' })),
  }
}

describe('POST knowledge-document upload completion', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth(createPersonalApiKeyPrincipal()))
    v2RouteMocks.preauthRate.mockResolvedValue({
      allowed: true,
      remaining: 599,
      resetAt: new Date('2026-08-04T21:00:00.000Z'),
    })
    v2RouteMocks.operationRate.mockResolvedValue({
      allowed: true,
      remaining: 99,
      resetAt: new Date('2026-08-04T21:00:00.000Z'),
    })
    mocks.completeUpload.mockResolvedValue(RESULT)
  })

  /**
   * `knowledge documents upload` answered `filename: null, processingStatus: null`:
   * the created row must come back under its own names, freshly `pending`
   * with no chunks yet, not only as a session receipt.
   */
  it('publishes the created row with its filename, pending status, and zero chunks', async () => {
    mocks.completeUpload.mockResolvedValue(RESULT)

    const response = await request().response
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      id: 'upload-1',
      status: 'completed',
      name: 'guide.pdf',
      document: {
        id: 'upload-1',
        filename: 'guide.pdf',
        processingStatus: 'pending',
        chunkCount: 0,
        createdAt: '2026-08-03T21:01:00.000Z',
      },
    })
  })

  it('does not duplicate analytics for an idempotent completion retry', async () => {
    mocks.completeUpload.mockResolvedValue({
      ...RESULT,
      value: { ...RESULT.value, created: false },
      alreadyCompleted: true,
    })

    const response = await request().response

    expect(response.status).toBe(200)
    expect(posthogServerMockFns.mockCaptureServerEvent).not.toHaveBeenCalled()
    expect(mockDocumentsUploaded).not.toHaveBeenCalled()
  })

  it('does not attribute a workspace-key event to the billing owner', async () => {
    v2RouteMocks.authenticate.mockResolvedValue(
      auth(createWorkspaceApiKeyPrincipal({ workspaceId: WORKSPACE_ID }))
    )

    await request().response

    expect(posthogServerMockFns.mockCaptureServerEvent).not.toHaveBeenCalled()
    expect(mockDocumentsUploaded).toHaveBeenCalledTimes(1)
  })
})
