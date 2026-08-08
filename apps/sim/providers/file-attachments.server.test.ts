/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import {
  buildOpenAIMessageContent,
  INLINE_ATTACHMENT_THRESHOLD_BYTES,
  LARGE_FILE_PATH_THRESHOLD_BYTES,
} from '@/providers/attachments'
import {
  attachLargeFileRemoteUrls,
  getInlineHydrationMaxBytes,
  uploadLargeFilesToProvider,
} from '@/providers/file-attachments.server'
import { runWithProviderRuntimeContext } from '@/providers/runtime-context'
import type { ProviderRequest } from '@/providers/types'

const {
  mockDownloadServableFileFromStorage,
  mockGeneratePresignedDownloadUrl,
  mockHasCloudStorage,
  mockVerifyFileAccess,
} = vi.hoisted(() => ({
  mockDownloadServableFileFromStorage: vi.fn(),
  mockGeneratePresignedDownloadUrl: vi.fn(),
  mockHasCloudStorage: vi.fn(),
  mockVerifyFileAccess: vi.fn(),
}))

vi.mock('@google/genai', () => ({
  FileState: { PROCESSING: 'PROCESSING', FAILED: 'FAILED' },
  GoogleGenAI: class {},
}))

vi.mock('@/lib/uploads', () => ({
  StorageService: {
    hasCloudStorage: mockHasCloudStorage,
    generatePresignedDownloadUrl: mockGeneratePresignedDownloadUrl,
  },
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mockDownloadServableFileFromStorage,
}))

vi.mock('@/app/api/files/authorization', () => ({
  verifyFileAccess: mockVerifyFileAccess,
}))

/** The exact file from the reported failure: 9,591,617 bytes — over 6 MiB, under 50 MB. */
const CSV_BYTES = 9_591_617

function makeRequest(size: number): ProviderRequest {
  return {
    model: 'gpt-4.1',
    apiKey: 'sk-test',
    userId: 'user-1',
    workflowId: 'workflow-1',
    messages: [
      {
        role: 'user',
        content: 'what does this say',
        files: [
          {
            id: 'file-1',
            name: 'data_10mb.csv',
            key: 'workspace/2f1d8c3e-5b6a-4c7d-8e9f-0a1b2c3d4e5f/data_10mb.csv',
            url: '',
            size,
            type: 'text/csv',
            context: 'workspace',
          },
        ],
      },
    ],
  } as unknown as ProviderRequest
}

describe('OpenAI large-file attachment lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasCloudStorage.mockReturnValue(true)
    mockVerifyFileAccess.mockResolvedValue(true)
    mockGeneratePresignedDownloadUrl.mockResolvedValue('https://storage.example.com/signed')
    mockDownloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.alloc(CSV_BYTES, 0x61),
      contentType: 'text/csv',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: 'file-abc' }), { status: 200 }))
    )
  })

  it('uploads to the Files API and references the file by id instead of inlining it', async () => {
    const request = makeRequest(CSV_BYTES)

    await attachLargeFileRemoteUrls(request, 'openai')
    await uploadLargeFilesToProvider(request, 'openai')

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/files')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer sk-test')

    const form = init.body as FormData
    expect(form.get('purpose')).toBe('user_data')
    expect(form.get('expires_after[anchor]')).toBe('created_at')
    expect(form.get('expires_after[seconds]')).toBe('3600')
    expect((form.get('file') as File).size).toBe(CSV_BYTES)

    const file = request.messages?.[0].files?.[0]
    expect(file?.providerFileId).toBe('file-abc')

    const content = buildOpenAIMessageContent(
      'what does this say',
      request.messages?.[0].files,
      'openai'
    )
    expect(content).toEqual([
      { type: 'input_text', text: 'what does this say' },
      { type: 'input_file', file_id: 'file-abc' },
    ])
  })

  it('preserves a multipart filename that collides with a configured secret', async () => {
    const request = makeRequest(CSV_BYTES)
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'FILE_NAME', plaintext: 'data_10mb.csv', encryptedValue: 'ciphertext' },
    ])

    await runWithProviderRuntimeContext({ resolvedSecretTraceRegistry: registry }, async () => {
      await attachLargeFileRemoteUrls(request, 'openai')
      await uploadLargeFilesToProvider(request, 'openai')
    })

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    const uploaded = (init.body as FormData).get('file') as File
    expect(uploaded.name).toBe('data_10mb.csv')
    expect(request.messages?.[0].files?.[0].name).toBe('data_10mb.csv')
  })

  /** Exactly at the crossover — `shouldUseLargeFilePath` uses `>`, so this must stay inline. */
  it('leaves a file exactly at the upload crossover on the base64 path', async () => {
    const request = makeRequest(LARGE_FILE_PATH_THRESHOLD_BYTES)

    await attachLargeFileRemoteUrls(request, 'openai')
    await uploadLargeFilesToProvider(request, 'openai')

    expect(fetch).not.toHaveBeenCalled()
    expect(request.messages?.[0].files?.[0].providerFileId).toBeUndefined()
    expect(request.messages?.[0].files?.[0].remoteUrl).toBeUndefined()
  })

  /**
   * The hydration cap has to track `shouldUseLargeFilePath`'s crossover exactly. Stopping short
   * of it leaves a band with neither base64 nor a handle — the defect this function was added to
   * remove — and `remote-url` deliberately crosses over later than `files-api`.
   */
  it('caps base64 hydration exactly where each strategy hands off to an upload', () => {
    mockHasCloudStorage.mockReturnValue(true)
    expect(getInlineHydrationMaxBytes('openai')).toBe(LARGE_FILE_PATH_THRESHOLD_BYTES)
    expect(getInlineHydrationMaxBytes('anthropic')).toBe(INLINE_ATTACHMENT_THRESHOLD_BYTES)
    expect(getInlineHydrationMaxBytes('bedrock')).toBe(INLINE_ATTACHMENT_THRESHOLD_BYTES)

    mockHasCloudStorage.mockReturnValue(false)
    expect(getInlineHydrationMaxBytes('openai')).toBe(INLINE_ATTACHMENT_THRESHOLD_BYTES)
    expect(getInlineHydrationMaxBytes('anthropic')).toBe(INLINE_ATTACHMENT_THRESHOLD_BYTES)
  })

  /**
   * Local and disk-backed deployments have no cloud storage, so the upload path cannot read the
   * bytes back. These files inline as base64 today and must keep doing so rather than hard-fail.
   */
  it('leaves the file for the inline path when cloud storage is unavailable', async () => {
    mockHasCloudStorage.mockReturnValue(false)
    const request = makeRequest(CSV_BYTES)

    await attachLargeFileRemoteUrls(request, 'openai')
    await uploadLargeFilesToProvider(request, 'openai')

    expect(fetch).not.toHaveBeenCalled()
    const file = request.messages?.[0].files?.[0]
    expect(file?.remoteUrl).toBeUndefined()
    expect(file?.providerFileId).toBeUndefined()
  })
})
