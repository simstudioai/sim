/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'
import type { ExecutionContext, UserFile } from '@/executor/types'
import type { ToolConfig } from '@/tools/types'

const { mockDownloadFileFromUrl, mockUploadExecutionFile } = vi.hoisted(() => ({
  mockDownloadFileFromUrl: vi.fn(),
  mockUploadExecutionFile: vi.fn(),
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromUrl: mockDownloadFileFromUrl,
}))

vi.mock('@/lib/uploads/contexts/execution', () => ({
  uploadExecutionFile: mockUploadExecutionFile,
  uploadFileFromRawData: vi.fn(),
}))

import { FileToolProcessor } from '@/executor/utils/file-tool-processor'

const executionContext = {
  executionId: 'execution-1',
  userId: 'user-1',
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
} as ExecutionContext

const toolConfig = {
  id: 'test_file_output',
  name: 'Test File Output',
  description: 'Test file output',
  version: '1.0.0',
  params: {},
  request: {
    url: () => 'https://example.com',
    method: 'GET',
  },
  outputs: {
    file: { type: 'file' },
  },
} satisfies ToolConfig

describe('FileToolProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUploadExecutionFile.mockResolvedValue({
      id: 'file-1',
      key: 'workspace/workspace-1/file-1',
      name: 'avatar.png',
      size: 12,
      type: 'image/png',
      url: '/api/files/serve?key=workspace%2Fworkspace-1%2Ffile-1',
    } satisfies UserFile)
  })

  it('caps URL downloads and stores raster images using byte-derived metadata', async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(4),
    ])
    mockDownloadFileFromUrl.mockResolvedValue(png)

    await FileToolProcessor.processToolOutputs(
      {
        file: {
          name: 'avatar.jpg',
          mimeType: 'image/jpeg',
          url: 'https://example.com/avatar',
        },
      },
      toolConfig,
      executionContext
    )

    expect(mockDownloadFileFromUrl).toHaveBeenCalledWith('https://example.com/avatar', {
      maxBytes: MAX_FILE_SIZE,
      userId: 'user-1',
    })
    expect(mockUploadExecutionFile).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: 'execution-1' }),
      png,
      'avatar.png',
      'image/png',
      'user-1'
    )
  })

  it('rejects oversized in-memory tool files before upload', async () => {
    const oversizedBuffer = Buffer.alloc(1)
    Object.defineProperty(oversizedBuffer, 'length', { value: MAX_FILE_SIZE + 1 })

    await expect(
      FileToolProcessor.processToolOutputs(
        {
          file: {
            data: oversizedBuffer,
            name: 'oversized.bin',
            mimeType: 'application/octet-stream',
          },
        },
        toolConfig,
        executionContext
      )
    ).rejects.toThrow('exceeds the maximum allowed size')

    expect(mockUploadExecutionFile).not.toHaveBeenCalled()
  })

  it.each([Buffer.alloc(0), '', { type: 'Buffer', data: [] }])(
    'stores valid zero-byte inline files as UserFile outputs: %j',
    async (data) => {
      const storedFile = {
        id: 'empty-file',
        key: 'workspace/workspace-1/empty-file',
        name: 'empty.txt',
        size: 0,
        type: 'text/plain',
        url: '/api/files/serve?key=workspace%2Fworkspace-1%2Fempty-file',
      } satisfies UserFile
      mockUploadExecutionFile.mockResolvedValue(storedFile)

      const result = await FileToolProcessor.processToolOutputs(
        { file: { name: 'empty.txt', mimeType: 'text/plain', data } },
        toolConfig,
        executionContext
      )

      expect(result.file).toEqual(storedFile)
      expect(mockUploadExecutionFile).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'workspace-1', executionId: 'execution-1' }),
        Buffer.alloc(0),
        'empty.txt',
        'text/plain',
        'user-1'
      )
      expect(mockDownloadFileFromUrl).not.toHaveBeenCalled()
    }
  )

  it('preserves empty file entries in file-array outputs', async () => {
    const result = await FileToolProcessor.processToolOutputs(
      { file: [{ name: 'empty.txt', mimeType: 'text/plain', data: '' }] },
      { ...toolConfig, outputs: { file: { type: 'file[]' } } },
      executionContext
    )

    expect(result.file).toHaveLength(1)
    expect(mockUploadExecutionFile.mock.calls[0]?.[1]).toEqual(Buffer.alloc(0))
  })

  it.each([Buffer.alloc(0), '', { type: 'Buffer', data: [] }])(
    'prefers the url over empty inline data: %j',
    async (data) => {
      mockDownloadFileFromUrl.mockResolvedValue(Buffer.from('downloaded'))

      await FileToolProcessor.processToolOutputs(
        {
          file: {
            name: 'file.txt',
            mimeType: 'text/plain',
            data,
            url: 'https://example.com/file',
          },
        },
        toolConfig,
        executionContext
      )

      expect(mockDownloadFileFromUrl).toHaveBeenCalledWith(
        'https://example.com/file',
        expect.objectContaining({ userId: 'user-1' })
      )
      expect(mockUploadExecutionFile.mock.calls[0]?.[1]).toEqual(Buffer.from('downloaded'))
    }
  )

  it.each([
    ['line-wrapped base64', 'SGVsbG8s\nIHdvcmxkIQ=='],
    ['unpadded base64url', 'SGVsbG8sIHdvcmxkIQ'],
    ['a base64 data URI', 'data:text/plain;base64,SGVsbG8sIHdvcmxkIQ=='],
  ])('decodes %s', async (_label, data) => {
    await FileToolProcessor.processToolOutputs(
      { file: { name: 'hello.txt', mimeType: 'text/plain', data } },
      toolConfig,
      executionContext
    )

    expect(mockUploadExecutionFile.mock.calls[0]?.[1]).toEqual(Buffer.from('Hello, world!'))
  })

  it('stores an empty base64 data URI as a zero-byte file', async () => {
    await FileToolProcessor.processToolOutputs(
      { file: { name: 'empty.txt', mimeType: 'text/plain', data: 'data:text/plain;base64,' } },
      toolConfig,
      executionContext
    )

    expect(mockUploadExecutionFile.mock.calls[0]?.[1]).toEqual(Buffer.alloc(0))
  })

  it('stores a successful zero-byte URL download', async () => {
    mockDownloadFileFromUrl.mockResolvedValue(Buffer.alloc(0))

    await FileToolProcessor.processToolOutputs(
      { file: { name: 'empty.txt', mimeType: 'text/plain', url: 'https://example.com/empty' } },
      toolConfig,
      executionContext
    )

    expect(mockUploadExecutionFile.mock.calls[0]?.[1]).toEqual(Buffer.alloc(0))
  })

  it.each([
    undefined,
    null,
    '!!!',
    'a!b!c!AAAA',
    'AAAAA',
    '  \n\t ',
    { type: 'Buffer', data: 'invalid' },
  ])('does not turn missing or malformed data into an empty file: %j', async (data) => {
    await expect(
      FileToolProcessor.processToolOutputs(
        { file: { name: 'invalid.txt', mimeType: 'text/plain', data } },
        toolConfig,
        executionContext
      )
    ).rejects.toThrow("Failed to process file output 'file'")

    expect(mockUploadExecutionFile).not.toHaveBeenCalled()
  })
})
