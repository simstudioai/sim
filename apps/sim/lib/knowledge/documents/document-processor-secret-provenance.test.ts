/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDownloadFileFromUrl,
  mockGenerateInternalToken,
  mockGetInternalApiBaseUrl,
  mockIsModelSafeWorkspaceFileKey,
} = vi.hoisted(() => ({
  mockDownloadFileFromUrl: vi.fn(),
  mockGenerateInternalToken: vi.fn(),
  mockGetInternalApiBaseUrl: vi.fn(),
  mockIsModelSafeWorkspaceFileKey: vi.fn(),
}))

vi.mock('@/lib/auth/internal', () => ({
  generateInternalToken: mockGenerateInternalToken,
}))

vi.mock('@/lib/core/utils/urls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/utils/urls')>()),
  getInternalApiBaseUrl: mockGetInternalApiBaseUrl,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  isModelSafeWorkspaceFileKey: mockIsModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE:
    'File cannot be sent to a model because its secret provenance is unavailable',
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromUrl: mockDownloadFileFromUrl,
}))

import { env } from '@/lib/core/config/env'
import { RESOLVED_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'
import { processDocument } from '@/lib/knowledge/documents/document-processor'
import { runWithKnowledgeModelInputProvenance } from '@/lib/knowledge/model-input-provenance'

describe('knowledge document model-input provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(env, {
      OCR_PROVIDER: 'azure-mistral',
      OCR_AZURE_API_KEY: 'test-key',
      OCR_AZURE_ENDPOINT: 'https://example.openai.azure.com',
      OCR_AZURE_MODEL_NAME: 'mistral-ocr',
      MISTRAL_API_KEY: '',
    })
    mockGenerateInternalToken.mockResolvedValue('internal-token')
    mockGetInternalApiBaseUrl.mockReturnValue('http://sim.local')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects an unsafe workspace file before downloading or parsing its bytes', async () => {
    mockIsModelSafeWorkspaceFileKey.mockResolvedValue(false)

    await expect(
      processDocument(
        '/api/files/serve/workspace/workspace-1/opaque.txt?context=workspace',
        'opaque.txt',
        'text/plain',
        1024,
        200,
        100,
        'user-1',
        'workspace-1'
      )
    ).rejects.toThrow('secret provenance is unavailable')

    expect(mockIsModelSafeWorkspaceFileKey).toHaveBeenCalledWith(
      'workspace/workspace-1/opaque.txt',
      { workspaceId: 'workspace-1' }
    )
    expect(mockDownloadFileFromUrl).not.toHaveBeenCalled()
  })

  it('rejects secret-bearing opaque document bytes before external OCR', async () => {
    await expect(
      runWithKnowledgeModelInputProvenance(
        undefined,
        () =>
          processDocument(
            'https://example.com/secret.pdf',
            'secret.pdf',
            'application/pdf',
            1024,
            200,
            100,
            'user-1'
          ),
        { opaqueInputSafe: false }
      )
    ).rejects.toThrow('Knowledge model input could not be safely projected')

    expect(mockDownloadFileFromUrl).not.toHaveBeenCalled()
  })

  it('attaches exact-empty provenance to the internal Mistral OCR request', async () => {
    Object.assign(env, {
      OCR_PROVIDER: 'mistral',
      MISTRAL_API_KEY: 'mistral-key',
    })
    mockDownloadFileFromUrl.mockResolvedValue(Buffer.from('not-a-real-pdf'))
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          pages: [{ markdown: 'Extracted document text' }],
          usage_info: { pages_processed: 1 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const processed = await runWithKnowledgeModelInputProvenance(
      undefined,
      () =>
        processDocument(
          'https://example.com/document.pdf',
          'document.pdf',
          'application/pdf',
          1024,
          200,
          1,
          'user-1'
        ),
      { opaqueInputSafe: true }
    )

    expect(processed.metadata.processingMethod).toBe('mistral-ocr')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(endpoint).toBe('http://sim.local/api/tools/mistral/parse')
    const headers = new Headers(init.headers)
    expect(headers.get('authorization')).toBe('Bearer internal-token')
    expect(headers.get('x-sim-private-model-input-provenance')).toBe(
      'resolved-secret-provenance-v1'
    )
    const requestBody = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(requestBody[RESOLVED_SECRET_PROVENANCE_FIELD]).toEqual({
      version: 1,
      complete: true,
      entries: [],
    })
  })
})
