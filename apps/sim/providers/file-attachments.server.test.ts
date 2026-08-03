/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildOpenAIMessageContent } from '@/providers/attachments'
import {
  attachLargeFileRemoteUrls,
  uploadLargeFilesToProvider,
} from '@/providers/file-attachments.server'
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

  it('leaves files at or below the inline cap on the base64 path', async () => {
    const request = makeRequest(5 * 1024 * 1024)

    await attachLargeFileRemoteUrls(request, 'openai')
    await uploadLargeFilesToProvider(request, 'openai')

    expect(fetch).not.toHaveBeenCalled()
    expect(request.messages?.[0].files?.[0].providerFileId).toBeUndefined()
    expect(request.messages?.[0].files?.[0].remoteUrl).toBeUndefined()
  })

  it('rejects a request whose attachments together exceed the combined ceiling', async () => {
    const request = makeRequest(30 * 1024 * 1024)
    const [first] = request.messages?.[0].files ?? []
    request.messages?.[0].files?.push({ ...first, id: 'file-2', key: `${first.key}-2` })

    await expect(attachLargeFileRemoteUrls(request, 'openai')).rejects.toThrow(
      /total 60.00MB, which exceeds the 48MB combined attachment limit/
    )
    expect(fetch).not.toHaveBeenCalled()
  })
})
