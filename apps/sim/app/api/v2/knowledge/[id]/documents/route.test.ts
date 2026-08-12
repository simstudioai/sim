/**
 * @vitest-environment node
 */
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2GateModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAdmitUpload,
  mockUploadDocument,
  mockReadFormData,
  mockReadFile,
  mockPlatformUploaded,
  mockCapture,
  mockIsPayloadSizeLimitError,
} = vi.hoisted(() => ({
  mockAdmitUpload: vi.fn(),
  mockUploadDocument: vi.fn(),
  mockReadFormData: vi.fn(),
  mockReadFile: vi.fn(),
  mockPlatformUploaded: vi.fn(),
  mockCapture: vi.fn(),
  mockIsPayloadSizeLimitError: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

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
  MAX_MULTIPART_OVERHEAD_BYTES: 1024 * 1024,
  isPayloadSizeLimitError: mockIsPayloadSizeLimitError,
  readFormDataWithLimit: mockReadFormData,
  readFileToBufferWithLimit: mockReadFile,
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { knowledgeBaseDocumentsUploaded: mockPlatformUploaded },
}))

vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mockCapture }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { KnowledgeUsageLimitExceededError } from '@/lib/knowledge/application/billing'
import { MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE } from '@/lib/uploads/shared/types'
import { validateFileType } from '@/lib/uploads/utils/validation'
import { POST } from '@/app/api/v2/knowledge/[id]/documents/route'

const WORKSPACE_ID = 'workspace-1'
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
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    v2RouteMocks.gate.mockResolvedValue(null)
    mockIsPayloadSizeLimitError.mockReturnValue(false)
    v2RouteMocks.authenticate.mockResolvedValue({
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
    })
    const formData = new FormData()
    formData.set('file', new File(['hello'], 'support.txt', { type: 'text/plain' }))
    mockReadFormData.mockResolvedValue(formData)
    mockReadFile.mockResolvedValue(Buffer.from('hello'))
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
    expect(mockUploadDocument).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        knowledgeBaseId: 'kb-1',
        assertedWorkspaceId: WORKSPACE_ID,
        file: {
          buffer: Buffer.from('hello'),
          filename: 'support.txt',
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
    expect(mockReadFormData).toHaveBeenCalledWith(request, {
      maxBytes: MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE + 1024 * 1024,
      label: 'knowledge document upload body',
    })
    expect(mockReadFile).toHaveBeenCalledWith(expect.any(File), {
      maxBytes: MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE,
      label: 'knowledge document file',
    })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-ratelimit-limit')).toBe('100')
  })

  it('maps usage admission to the v2 error before multipart buffering', async () => {
    mockAdmitUpload.mockRejectedValue(new KnowledgeUsageLimitExceededError('Upgrade required'))

    const response = await POST(buildRequest(), { params: Promise.resolve({ id: 'kb-1' }) })

    expect(response.status).toBe(402)
    expect(await response.json()).toEqual({
      error: { code: 'USAGE_LIMIT_EXCEEDED', message: 'Upgrade required' },
    })
    expect(mockReadFormData).not.toHaveBeenCalled()
    expect(mockUploadDocument).not.toHaveBeenCalled()
  })

  it('does not create human analytics for a workspace key', async () => {
    v2RouteMocks.authenticate.mockResolvedValue({
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

  it('preserves the malformed multipart envelope without entering the upload operation', async () => {
    mockReadFormData.mockRejectedValueOnce(new Error('multipart boundary missing'))

    const response = await POST(buildRequest(), { params: Promise.resolve({ id: 'kb-1' }) })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: { code: 'BAD_REQUEST', message: 'Request body must be valid multipart form data' },
    })
    expect(mockUploadDocument).not.toHaveBeenCalled()
    expect(mockPlatformUploaded).not.toHaveBeenCalled()
  })

  it('preserves bounded multipart rejection and stops before the upload operation', async () => {
    const error = new Error('knowledge document upload body exceeds maximum size')
    mockReadFormData.mockRejectedValueOnce(error)
    mockIsPayloadSizeLimitError.mockImplementation((candidate: unknown) => candidate === error)

    const response = await POST(buildRequest(), { params: Promise.resolve({ id: 'kb-1' }) })

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: error.message },
    })
    expect(mockUploadDocument).not.toHaveBeenCalled()
  })

  it('requires a file form field before the upload operation', async () => {
    mockReadFormData.mockResolvedValueOnce(new FormData())

    const response = await POST(buildRequest(), { params: Promise.resolve({ id: 'kb-1' }) })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: { code: 'BAD_REQUEST', message: 'file form field is required' },
    })
    expect(mockUploadDocument).not.toHaveBeenCalled()
  })

  it('preserves the exact file-size rejection before reading file bytes', async () => {
    const formData = new FormData()
    const file = new File(['x'], 'large.txt', { type: 'text/plain' })
    Object.defineProperty(file, 'size', { value: MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE + 1 })
    formData.set('file', file)
    mockReadFormData.mockResolvedValueOnce(formData)

    const response = await POST(buildRequest(), { params: Promise.resolve({ id: 'kb-1' }) })

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'File size exceeds 100MB limit (100.00MB)' },
    })
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(mockUploadDocument).not.toHaveBeenCalled()
  })

  it('preserves unsupported file-type validation before reading file bytes', async () => {
    const formData = new FormData()
    formData.set('file', new File(['x'], 'malware.exe', { type: 'application/octet-stream' }))
    mockReadFormData.mockResolvedValueOnce(formData)
    const expectedMessage = validateFileType('malware.exe', 'application/octet-stream')?.message
    if (!expectedMessage) throw new Error('Expected unsupported file type validation to fail')

    const response = await POST(buildRequest(), { params: Promise.resolve({ id: 'kb-1' }) })

    expect(response.status).toBe(415)
    expect(await response.json()).toEqual({
      error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: expectedMessage },
    })
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(mockUploadDocument).not.toHaveBeenCalled()
  })

  it('does not emit effects when the upload operation fails', async () => {
    mockUploadDocument.mockRejectedValueOnce(new Error('storage unavailable'))

    const response = await POST(buildRequest(), { params: Promise.resolve({ id: 'kb-1' }) })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
    expect(mockUploadDocument).toHaveBeenCalledOnce()
    expect(mockPlatformUploaded).not.toHaveBeenCalled()
    expect(mockCapture).not.toHaveBeenCalled()
  })

  it('preserves final application authorization errors', async () => {
    mockUploadDocument.mockRejectedValueOnce(
      new OrchestrationError('forbidden', 'Insufficient workspace permissions')
    )

    const response = await POST(buildRequest(), { params: Promise.resolve({ id: 'kb-1' }) })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: { code: 'FORBIDDEN', message: 'Insufficient workspace permissions' },
    })
    expect(mockUploadDocument).toHaveBeenCalledOnce()
    expect(mockPlatformUploaded).not.toHaveBeenCalled()
    expect(mockCapture).not.toHaveBeenCalled()
  })
})
