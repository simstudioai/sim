/**
 * @vitest-environment node
 */
import { interruptibleSleep } from '@sim/utils/helpers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDownloadFileFromUrl,
  mockGenerateInternalToken,
  mockGetInternalApiBaseUrl,
  mockExecuteMistralParse,
  mockParseBuffer,
  mockAdmit,
} = vi.hoisted(() => ({
  mockDownloadFileFromUrl: vi.fn(),
  mockGenerateInternalToken: vi.fn(),
  mockGetInternalApiBaseUrl: vi.fn(),
  mockExecuteMistralParse: vi.fn(),
  mockParseBuffer: vi.fn(),
  mockAdmit: vi.fn(),
}))

vi.mock('@/lib/core/rate-limiter/provider-admission', () => ({
  PROVIDER_QUOTA_COOLDOWN_MS: 300_000,
  ProviderQuotaExhaustedError: class ProviderQuotaExhaustedError extends Error {},
  isProviderQuotaExhausted: vi.fn().mockResolvedValue(false),
  recordProviderCooldown: vi.fn().mockResolvedValue(undefined),
  waitForProviderAdmission: mockAdmit,
}))

vi.mock('@/lib/auth/internal', () => ({
  generateInternalToken: mockGenerateInternalToken,
}))

vi.mock('@/lib/core/utils/urls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/utils/urls')>()),
  getInternalApiBaseUrl: mockGetInternalApiBaseUrl,
}))

vi.mock('@/lib/file-parsers', () => ({
  parseBuffer: mockParseBuffer,
  isSupportedFileType: (extension: string) => ['pdf', 'docx', 'txt', 'csv'].includes(extension),
}))

vi.mock('@/lib/internal/mistral/operations', () => ({
  executeMistralParse: mockExecuteMistralParse,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromUrl: mockDownloadFileFromUrl,
}))

import { env } from '@/lib/core/config/env'
import { RESOLVED_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'
import { processDocument } from '@/lib/knowledge/documents/document-processor'
import { runWithKnowledgeModelInputProvenance } from '@/lib/knowledge/model-input-provenance'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

describe('knowledge document model-input provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAdmit.mockReset().mockResolvedValue(undefined)
    Object.assign(env, {
      OCR_PROVIDER: 'azure-mistral',
      OCR_AZURE_API_KEY: 'test-key',
      OCR_AZURE_ENDPOINT: 'https://example.openai.azure.com',
      OCR_AZURE_MODEL_NAME: 'mistral-ocr',
      MISTRAL_API_KEY: '',
    })
    mockGenerateInternalToken.mockResolvedValue('internal-token')
    mockGetInternalApiBaseUrl.mockReturnValue('http://sim.local')
    mockExecuteMistralParse.mockResolvedValue({
      success: true,
      output: {
        pages: [{ markdown: 'Extracted document text' }],
        usage_info: { pages_processed: 1 },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('parses tracked workspace-file bytes locally without treating parsing as model egress', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'tracked-secret', encryptedValue: 'encrypted-token' },
    ])
    registry.recordResolved('TOKEN', 'tracked-secret')
    mockDownloadFileFromUrl.mockResolvedValue(
      Buffer.from('Locally parsed content containing tracked-secret.')
    )
    mockParseBuffer.mockResolvedValue({
      content: 'Locally parsed content containing tracked-secret.',
      metadata: {},
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const processed = await runWithKnowledgeModelInputProvenance(registry, () =>
      processDocument(
        '/api/files/serve/workspace/workspace-1/tracked.txt?context=workspace',
        'tracked.txt',
        'text/plain',
        1024,
        200,
        1,
        'user-1',
        'workspace-1'
      )
    )

    expect(processed.metadata.processingMethod).toBe('file-parser')
    expect(processed.chunks.map((chunk) => chunk.text).join('\n')).toContain('tracked-secret')
    expect(mockDownloadFileFromUrl).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /**
   * The refusal guards egress to an external model, so it is asserted against the
   * outbound request rather than the storage read. A PDF is now parsed locally
   * first and only reaches OCR when it has no usable text layer — local parsing is
   * not model input, as the case above establishes — so the bytes are read before
   * the projection is checked, and never leave the worker when it refuses.
   */
  it('rejects secret-bearing opaque document bytes before external OCR', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

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

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('attaches exact-empty provenance to the internal Mistral OCR request', async () => {
    Object.assign(env, {
      OCR_PROVIDER: 'mistral',
      MISTRAL_API_KEY: 'mistral-key',
    })
    mockDownloadFileFromUrl.mockResolvedValue(Buffer.from('not-a-real-pdf'))
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
    expect(mockExecuteMistralParse).toHaveBeenCalledOnce()
    const [requestBody, context] = mockExecuteMistralParse.mock.calls[0] as [
      Record<string, unknown>,
      { headers: Headers },
    ]
    const headers = context.headers
    expect(headers.get('x-sim-private-model-input-provenance')).toBe(
      'resolved-secret-provenance-v1'
    )
    expect(requestBody[RESOLVED_SECRET_PROVENANCE_FIELD]).toEqual({
      version: 1,
      complete: true,
      entries: [],
    })
  })
  it('bounds Azure OCR admission and response reading with one overall deadline', async () => {
    vi.useFakeTimers()
    mockDownloadFileFromUrl.mockResolvedValue(Buffer.from('synthetic image'))
    mockAdmit.mockImplementationOnce(() => interruptibleSleep(90_000))
    const cancelBody = vi.fn()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(new ReadableStream({ cancel: cancelBody })))
    vi.stubGlobal('fetch', fetchMock)
    const pending = runWithKnowledgeModelInputProvenance(
      undefined,
      () =>
        processDocument(
          'https://example.com/fixture.png',
          'fixture.png',
          'image/png',
          1024,
          200,
          1,
          'user-1'
        ),
      { opaqueInputSafe: true }
    )
    const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(119_999)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(cancelBody).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await rejected
    expect(cancelBody).toHaveBeenCalledOnce()
    expect(mockAdmit).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds direct Mistral execution with the same deadline and stops retries', async () => {
    vi.useFakeTimers()
    Object.assign(env, { OCR_PROVIDER: 'mistral', MISTRAL_API_KEY: 'mistral-key' })
    mockDownloadFileFromUrl.mockResolvedValue(Buffer.from('synthetic image'))
    mockExecuteMistralParse.mockImplementationOnce(
      (_input, context: { signal: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          context.signal.addEventListener('abort', () => reject(context.signal.reason), {
            once: true,
          })
        })
    )
    const pending = runWithKnowledgeModelInputProvenance(
      undefined,
      () =>
        processDocument(
          'https://example.com/fixture.png',
          'fixture.png',
          'image/png',
          1024,
          200,
          1,
          'user-1'
        ),
      { opaqueInputSafe: true }
    )
    const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(120_000)
    await rejected
    expect(mockExecuteMistralParse).toHaveBeenCalledOnce()
    expect(mockExecuteMistralParse.mock.calls[0][1]).toMatchObject({
      deadlineAt: expect.any(Number),
    })
    expect(vi.getTimerCount()).toBe(0)
  })
})
