/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthenticate,
  mockCheckPreAuth,
  mockCheckRateLimit,
  mockAdmitUpload,
  mockUploadDocument,
  mockReadFormData,
  mockReadFile,
  mockUploadWorkspaceFile,
  mockPlatformUploaded,
  mockCapture,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockCheckPreAuth: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockAdmitUpload: vi.fn(),
  mockUploadDocument: vi.fn(),
  mockReadFormData: vi.fn(),
  mockReadFile: vi.fn(),
  mockUploadWorkspaceFile: vi.fn(),
  mockPlatformUploaded: vi.fn(),
  mockCapture: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mockAuthenticate,
  V2ApiKeyUnauthenticatedError: class V2ApiKeyUnauthenticatedError extends Error {},
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  getRateLimit: () => ({ maxTokens: 100, refillRate: 100, refillIntervalMs: 60_000 }),
  RateLimiter: class RateLimiter {
    checkRateLimitDirect(...args: unknown[]) {
      return mockCheckPreAuth(...args)
    }

    checkRateLimitDirectOrThrow(...args: unknown[]) {
      return mockCheckRateLimit(...args)
    }
  },
}))

vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: vi.fn().mockResolvedValue(null) }))

vi.mock('@/lib/knowledge/application/documents', () => ({
  listKnowledgeDocuments: {
    operation: { id: 'knowledge.documents.list' },
    execute: vi.fn(),
  },
  admitKnowledgeDocumentUpload: {
    operation: { id: 'knowledge.documents.upload' },
    execute: mockAdmitUpload,
  },
  uploadKnowledgeDocument: {
    operation: { id: 'knowledge.documents.upload' },
    execute: mockUploadDocument,
  },
}))

vi.mock('@/lib/core/utils/stream-limits', () => ({
  isPayloadSizeLimitError: () => false,
  readFormDataWithLimit: mockReadFormData,
  readFileToBufferWithLimit: mockReadFile,
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  uploadWorkspaceFile: mockUploadWorkspaceFile,
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { knowledgeBaseDocumentsUploaded: mockPlatformUploaded },
}))

vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mockCapture }))

import { KnowledgeUsageLimitExceededError } from '@/lib/knowledge/application/billing'
import { POST } from '@/app/api/v2/knowledge/[id]/documents/route'

const WORKSPACE_ID = 'workspace-1'
const RATE_LIMIT_OK = {
  allowed: true,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
  retryAfterMs: 0,
}
const PRINCIPAL = { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' } as const

function buildRequest() {
  return new NextRequest(
    `http://localhost/api/v2/knowledge/kb-1/documents?workspaceId=${WORKSPACE_ID}`,
    { method: 'POST', headers: { 'x-api-key': 'secret' }, body: 'multipart-placeholder' }
  )
}

describe('POST /api/v2/knowledge/[id]/documents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckPreAuth.mockResolvedValue(RATE_LIMIT_OK)
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockAuthenticate.mockResolvedValue({
      principal: PRINCIPAL,
      rolloutUserId: 'user-1',
      rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'],
      rateLimitSubscription: null,
      keyType: 'personal',
    })
    mockAdmitUpload.mockResolvedValue({
      knowledgeBaseId: 'kb-1',
      knowledgeBaseName: 'Support docs',
      workspaceId: WORKSPACE_ID,
      storageActorUserId: 'user-1',
    })
    const formData = new FormData()
    formData.set('file', new File(['hello'], 'support.txt', { type: 'text/plain' }))
    mockReadFormData.mockResolvedValue(formData)
    mockReadFile.mockResolvedValue(Buffer.from('hello'))
    mockUploadWorkspaceFile.mockResolvedValue({ url: 's3://workspace/support.txt' })
    mockUploadDocument.mockResolvedValue({
      created: true,
      document: {
        id: 'doc-1',
        knowledgeBaseId: 'kb-1',
        filename: 'support.txt',
        fileUrl: 's3://workspace/support.txt',
        fileSize: 5,
        mimeType: 'text/plain',
        chunkCount: 0,
        tokenCount: 0,
        characterCount: 0,
        enabled: true,
        uploadedAt: new Date('2024-01-01T00:00:00Z'),
      },
    })
  })

  it('admits before buffering and reauthorizes durable registration with code-defined admission', async () => {
    const request = buildRequest()

    const response = await POST(request, { params: Promise.resolve({ id: 'kb-1' }) })

    expect(response.status).toBe(201)
    expect(mockAdmitUpload.mock.invocationCallOrder[0]).toBeLessThan(
      mockReadFormData.mock.invocationCallOrder[0]
    )
    expect(mockAdmitUpload).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { knowledgeBaseId: 'kb-1', assertedWorkspaceId: WORKSPACE_ID },
      request,
    })
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      WORKSPACE_ID,
      'user-1',
      Buffer.from('hello'),
      'support.txt',
      'text/plain'
    )
    expect(mockUploadDocument).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        knowledgeBaseId: 'kb-1',
        assertedWorkspaceId: WORKSPACE_ID,
        document: {
          filename: 'support.txt',
          fileUrl: 's3://workspace/support.txt',
          fileSize: 5,
          mimeType: 'text/plain',
        },
        startProcessing: true,
        usageAdmission: 'pre_admitted',
        source: 'api',
      },
      request,
    })
    expect(mockPlatformUploaded).toHaveBeenCalledOnce()
    expect(mockCapture).toHaveBeenCalledWith(
      'user-1',
      'knowledge_base_document_uploaded',
      expect.objectContaining({ knowledge_base_id: 'kb-1' }),
      expect.any(Object)
    )
  })

  it('maps usage admission to the v2 error before multipart buffering', async () => {
    mockAdmitUpload.mockRejectedValue(new KnowledgeUsageLimitExceededError('Upgrade required'))

    const response = await POST(buildRequest(), { params: Promise.resolve({ id: 'kb-1' }) })

    expect(response.status).toBe(402)
    expect(await response.json()).toEqual({
      error: { code: 'USAGE_LIMIT_EXCEEDED', message: 'Upgrade required' },
    })
    expect(mockReadFormData).not.toHaveBeenCalled()
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
    expect(mockUploadDocument).not.toHaveBeenCalled()
  })

  it('does not create human analytics for a workspace key', async () => {
    mockAuthenticate.mockResolvedValue({
      principal: { kind: 'workspace_api_key', workspaceId: WORKSPACE_ID, keyId: 'key-2' },
      rolloutUserId: 'billing-owner',
      rateLimitSubjectIds: ['api-key:key-2', `workspace:${WORKSPACE_ID}`],
      rateLimitSubscription: null,
      keyType: 'workspace',
    })

    const response = await POST(buildRequest(), { params: Promise.resolve({ id: 'kb-1' }) })

    expect(response.status).toBe(201)
    expect(mockPlatformUploaded).toHaveBeenCalledOnce()
    expect(mockCapture).not.toHaveBeenCalled()
  })
})
