import {
  executorPrincipalMock,
  executorPrincipalMockFns,
} from '@sim/testing/mocks/executor-principal.mock'
import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import {
  filesAuthorizationMock,
  filesAuthorizationMockFns,
} from '@sim/testing/mocks/files-authorization.mock'
import { storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { uploadsMock } from '@sim/testing/mocks/uploads.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import {
  buildOpenAIMessageContent,
  getProviderFileStrategy,
  INLINE_ATTACHMENT_THRESHOLD_BYTES,
  LARGE_FILE_PATH_THRESHOLD_BYTES,
} from '@/providers/attachments'
import {
  attachLargeFileRemoteUrls,
  getInlineHydrationMaxBytes,
  uploadLargeFilesToProvider,
} from '@/providers/file-attachments.server'
import { PROVIDER_DEFINITIONS } from '@/providers/models'
import { runWithProviderRuntimeContext } from '@/providers/runtime-context'
import type { ProviderRequest } from '@/providers/types'

const mockCreateExecutorPrincipal =
  executorPrincipalMockFns.mockCreateExecutorPrincipalFromExecutionContext

const mockVerifyFileAccess = filesAuthorizationMockFns.mockVerifyFileAccess
const mockDownloadServableFileFromStorage =
  fileUtilsServerMockFns.mockDownloadServableFileFromStorage
const mockHasCloudStorage = storageServiceMockFns.mockHasCloudStorage
const mockGeneratePresignedDownloadUrl = storageServiceMockFns.mockGeneratePresignedDownloadUrl

const { mockAssertUserFileContentAccess, mockGoogleUpload } = vi.hoisted(() => ({
  mockAssertUserFileContentAccess: vi.fn(),
  mockGoogleUpload: vi.fn(),
}))

vi.mock('@/lib/internal/principals/executor', () => executorPrincipalMock)

vi.mock('@/lib/execution/payloads/materialization.server', () => ({
  assertUserFileContentAccess: mockAssertUserFileContentAccess,
}))

vi.mock('@google/genai', () => ({
  FileState: { PROCESSING: 'PROCESSING', FAILED: 'FAILED' },
  GoogleGenAI: class {
    files = { upload: mockGoogleUpload }
  },
}))

vi.mock('@/lib/uploads', () => uploadsMock)

vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)

vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)

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
    mockHasCloudStorage.mockReturnValue(true)
    mockVerifyFileAccess.mockResolvedValue(true)
    mockCreateExecutorPrincipal.mockResolvedValue({
      kind: 'delegated',
      serviceId: 'executor',
      workspaceId: 'workspace-1',
    })
    mockAssertUserFileContentAccess.mockResolvedValue(undefined)
    mockGoogleUpload.mockResolvedValue({
      name: 'files/harness',
      uri: 'https://generativelanguage.googleapis.com/files/harness',
      state: 'ACTIVE',
    })
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

  const executionContext = {
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    executionId: 'execution-1',
    userId: 'billing-owner',
    principal: {
      kind: 'system',
      serviceId: 'chat',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
    },
    executorDelegationOrigin: { workflowId: 'workflow-1', executionId: 'execution-1' },
  } as ExecutionContext

  it.each(Object.keys(PROVIDER_DEFINITIONS))(
    'preserves %s attachment strategy while authorizing remote bytes as the execution',
    async (provider) => {
      const request = makeRequest(INLINE_ATTACHMENT_THRESHOLD_BYTES + 1)
      await attachLargeFileRemoteUrls(request, provider, executionContext)
      const largeFile = getProviderFileStrategy(provider) !== 'inline'
      expect(mockCreateExecutorPrincipal).toHaveBeenCalledTimes(largeFile ? 1 : 0)
      expect(mockAssertUserFileContentAccess).toHaveBeenCalledTimes(largeFile ? 1 : 0)
      expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalledTimes(largeFile ? 1 : 0)
      expect(mockVerifyFileAccess).not.toHaveBeenCalled()
      if (largeFile) {
        expect(mockCreateExecutorPrincipal).toHaveBeenCalledWith({
          context: executionContext,
          audience: 'sim:workspace-files',
        })
        expect(mockAssertUserFileContentAccess).toHaveBeenCalledWith(
          request.messages?.[0].files?.[0],
          expect.objectContaining({
            principal: { kind: 'delegated', serviceId: 'executor', workspaceId: 'workspace-1' },
            userId: undefined,
            executionId: 'execution-1',
          })
        )
      }
    }
  )

  it('rechecks current access before a Files API upload and does not fall back to the billing owner', async () => {
    const request = makeRequest(CSV_BYTES)
    await attachLargeFileRemoteUrls(request, 'openai', executionContext)
    mockAssertUserFileContentAccess.mockRejectedValueOnce(new Error('Access revoked'))
    await expect(uploadLargeFilesToProvider(request, 'openai', executionContext)).rejects.toThrow(
      'Access revoked'
    )
    expect(mockCreateExecutorPrincipal).toHaveBeenCalledTimes(2)
    expect(mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
    expect(mockVerifyFileAccess).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['openai', 'google'])(
    'uploads an authorized actorless workspace file through %s',
    async (provider) => {
      const request = makeRequest(CSV_BYTES)
      await attachLargeFileRemoteUrls(request, provider, executionContext)
      await uploadLargeFilesToProvider(request, provider, executionContext)
      expect(mockCreateExecutorPrincipal).toHaveBeenCalledTimes(2)
      expect(mockAssertUserFileContentAccess).toHaveBeenCalledTimes(2)
      expect(mockVerifyFileAccess).not.toHaveBeenCalled()
      const file = request.messages?.[0].files?.[0]
      if (provider === 'openai') expect(file?.providerFileId).toBe('file-abc')
      else
        expect(file?.providerFileUri).toBe(
          'https://generativelanguage.googleapis.com/files/harness'
        )
    }
  )

  it('does not mint a remote URL after execution authorization fails', async () => {
    mockCreateExecutorPrincipal.mockRejectedValueOnce(new Error('Run no longer active'))
    await expect(
      attachLargeFileRemoteUrls(makeRequest(CSV_BYTES), 'openai', executionContext)
    ).rejects.toThrow('Run no longer active')
    expect(mockGeneratePresignedDownloadUrl).not.toHaveBeenCalled()
    expect(mockVerifyFileAccess).not.toHaveBeenCalled()
  })

  it('ignores forged execution authority on an ordinary provider request', async () => {
    const request = { ...makeRequest(CSV_BYTES), executionContext }
    mockVerifyFileAccess.mockResolvedValueOnce(false)
    await expect(attachLargeFileRemoteUrls(request, 'openai')).rejects.toThrow('not accessible')
    expect(mockCreateExecutorPrincipal).not.toHaveBeenCalled()
    expect(mockGeneratePresignedDownloadUrl).not.toHaveBeenCalled()
  })
})
