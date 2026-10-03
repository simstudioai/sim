import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { uploadsCopilotMock, uploadsCopilotMockFns } from '@sim/testing/mocks/uploads-copilot.mock'
import {
  uploadsExecutionMock,
  uploadsExecutionMockFns,
} from '@sim/testing/mocks/uploads-execution.mock'
import {
  uploadsMetadataMock,
  uploadsMetadataMockFns,
} from '@sim/testing/mocks/uploads-metadata.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'
import type { ExecutionContext, UserFile } from '@/executor/types'
import type { ToolConfig, ToolDefinition } from '@/tools/types'

vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)

vi.mock('@/lib/uploads/contexts/execution', () => uploadsExecutionMock)
vi.mock('@/lib/uploads/contexts/copilot', () => uploadsCopilotMock)
vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)
vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)

import { FileToolProcessor } from '@/executor/utils/file-tool-processor'

const mockUploadExecutionFile = uploadsExecutionMockFns.mockUploadExecutionFile
const mocks = {
  uploadExecution: mockUploadExecutionFile,
  uploadCopilot: uploadsCopilotMockFns.mockUploadCopilotFile,
}
const mockDownloadFileFromUrl = fileUtilsServerMockFns.mockDownloadFileFromUrl
const mockDeleteFile = storageServiceMockFns.mockDeleteFile
const mockDeleteFileMetadata = uploadsMetadataMockFns.mockDeleteFileMetadata

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

describe('copilot tool execution context', () => {
  const context: InternalToolOperationContext = {
    workflowId: '',
    userId: 'actor-1',
    workspaceId: 'workspace-1',
    copilotToolExecution: true,
  }
  const tool = {
    id: 'test_attachments',
    name: 'Test attachments',
    description: 'Downloads message attachments',
    version: '1.0.0',
    params: {},
    request: { url: 'https://example.com/messages', method: 'GET' },
    outputs: { files: { type: 'file[]' } },
  } satisfies ToolConfig

  const stored: UserFile = {
    id: 'file-1',
    key: 'copilot/actor-1/file-1/workbook.xlsx',
    name: 'workbook.xlsx',
    type: 'application/octet-stream',
    size: 12 * 1024 * 1024,
    url: 'https://storage.example/workbook.xlsx',
    context: 'copilot',
  }

  describe('file output processing across trusted contexts', () => {
    beforeEach(() => {
      vi.resetAllMocks()
      mocks.uploadCopilot.mockResolvedValue(stored)
    })

    it('stores a large late attachment once and replaces every nested alias for Copilot', async () => {
      const bytes = Buffer.alloc(12 * 1024 * 1024)
      const attachment = { name: 'workbook.xlsx', contentType: stored.type, data: bytes }
      const input = { files: [attachment, attachment], results: [{ attachments: [attachment] }] }

      const result = await FileToolProcessor.processToolOutputs(input, tool, context)

      expect(result).toEqual({ files: [stored, stored], results: [{ attachments: [stored] }] })
      expect((result.files as UserFile[])[0]).toBe(stored)
      expect(mocks.uploadCopilot).toHaveBeenCalledOnce()
      expect(mocks.uploadCopilot.mock.calls[0]?.[0].buffer).toBe(bytes)
      expect(mocks.uploadCopilot.mock.calls[0]?.[0].userId).toBe('actor-1')
      expect(mocks.uploadExecution).not.toHaveBeenCalled()
      expect(JSON.stringify(result).length).toBeLessThan(2048)
      expect(input.results[0]?.attachments[0]?.data).toBe(bytes)
    })

    it('rejects an aggregate over budget before uploading any file', async () => {
      const first = Buffer.alloc(1)
      Object.defineProperty(first, 'length', { value: MAX_FILE_SIZE })
      await expect(
        FileToolProcessor.processToolOutputs(
          {
            files: [
              { name: 'first.bin', data: first },
              { name: 'second.bin', data: Buffer.alloc(1) },
            ],
          },
          tool,
          context
        )
      ).rejects.toThrow('exceeds the maximum allowed size')
      expect(mocks.uploadCopilot).not.toHaveBeenCalled()
    })

    it('validates all files before creating storage objects', async () => {
      await expect(
        FileToolProcessor.processToolOutputs(
          {
            files: [
              { name: 'valid.txt', data: Buffer.from('valid') },
              { name: 'invalid.txt', data: '?' },
            ],
          },
          tool,
          context
        )
      ).rejects.toThrow('invalid base64')
      expect(mocks.uploadCopilot).not.toHaveBeenCalled()
    })

    it('passes the remaining aggregate budget and cancellation signal to URL downloads', async () => {
      const controller = new AbortController()
      mockDownloadFileFromUrl.mockImplementation(async () => {
        controller.abort(new Error('Download cancelled'))
        return Buffer.alloc(1)
      })
      await expect(
        FileToolProcessor.processToolOutputs(
          {
            files: [
              { name: 'first.txt', data: Buffer.alloc(3) },
              { name: 'second.txt', url: 'https://example.com/file' },
            ],
          },
          tool,
          context,
          controller.signal
        )
      ).rejects.toThrow('Download cancelled')
      expect(mockDownloadFileFromUrl).toHaveBeenCalledWith('https://example.com/file', {
        userId: 'actor-1',
        maxBytes: MAX_FILE_SIZE - 3,
        signal: controller.signal,
      })
      expect(mocks.uploadCopilot).not.toHaveBeenCalled()
    })

    it('removes materialized base64 from existing references and their nested aliases', async () => {
      const materialized = { ...stored, base64: 'c2VjcmV0' }
      const result = await FileToolProcessor.processToolOutputs(
        { files: [materialized], messages: [{ file: materialized }] },
        tool,
        context
      )
      expect(result).toEqual({ files: [stored], messages: [{ file: stored }] })
      expect(mocks.uploadCopilot).not.toHaveBeenCalled()
      expect(mockDownloadFileFromUrl).not.toHaveBeenCalled()
    })

    it('rolls back an unpublished attachment if a later upload fails', async () => {
      mocks.uploadCopilot
        .mockResolvedValueOnce(stored)
        .mockRejectedValueOnce(new Error('Storage down'))
      await expect(
        FileToolProcessor.processToolOutputs(
          {
            files: [
              { name: 'first.txt', data: Buffer.from('a') },
              { name: 'second.txt', data: Buffer.from('b') },
            ],
          },
          tool,
          context
        )
      ).rejects.toThrow('Storage down')
      expect(mockDeleteFile).toHaveBeenCalledWith({ key: stored.key, context: 'copilot' })
      expect(mockDeleteFileMetadata).toHaveBeenCalledWith(stored.key)
    })
  })
})

describe('file output aliases', () => {
  const STORED_FILE: UserFile = {
    id: 'file-1',
    key: 'execution/file-1',
    url: '/api/files/serve/execution/file-1',
    name: 'notes.txt',
    type: 'text/plain',
    size: 5,
    base64: 'aGVsbG8=',
  }
  const TOOL: ToolDefinition = {
    id: 'alias-test',
    name: 'Alias Test',
    description: 'File aliases',
    version: '1.0.0',
    params: {},
    outputs: { file: { type: 'file', description: 'Stored file' } },
  }
  const CONTEXT = {
    workflowId: 'workflow-1',
    executionId: 'execution-1',
    workspaceId: 'workspace-1',
  }

  describe('file output alias replacement', () => {
    it('handles deeply nested, small JSON metadata without recursive stack growth', async () => {
      const depth = 20_000
      const json = `${'{"child":'.repeat(depth)}null${'}'.repeat(depth)}`
      const metadata: Record<string, unknown> = JSON.parse(json)
      const result = await FileToolProcessor.processToolOutputs(
        { file: STORED_FILE, metadata },
        TOOL,
        CONTEXT
      )

      expect(json.length).toBeLessThan(1024 * 1024)
      expect(result.file).not.toHaveProperty('base64')
      expect(result.metadata === metadata).toBe(false)
      let cursor: unknown = result.metadata
      let actualDepth = 0
      while (cursor && typeof cursor === 'object' && 'child' in cursor) {
        actualDepth++
        cursor = cursor.child
      }
      expect(actualDepth).toBe(depth)
      expect(cursor).toBeNull()
    })

    it('preserves cycles and shared aliases while replacing every reference to the file', async () => {
      const shared = { file: STORED_FILE }
      const input: Record<string, unknown> = {
        file: STORED_FILE,
        messages: [shared, shared],
      }
      input.self = input
      const result = await FileToolProcessor.processToolOutputs(input, TOOL, CONTEXT)
      expect(result.self).toBe(result)
      const messages = result.messages as Array<{ file: UserFile }>
      expect(messages[0]).toBe(messages[1])
      expect(messages[0]?.file).toBe(result.file)
      expect(result.file).not.toHaveProperty('base64')
      expect(STORED_FILE.base64).toBe('aGVsbG8=')
      expect(input.self).toBe(input)
    })

    it('keeps buffers, stored files, and non-plain objects as leaves', async () => {
      const buffer = Buffer.alloc(12 * 1024 * 1024)
      const date = new Date('2026-01-01')
      const existing = { ...STORED_FILE, id: 'existing-file', base64: undefined }
      const result = await FileToolProcessor.processToolOutputs(
        { file: STORED_FILE, metadata: { buffer, date, existing } },
        TOOL,
        CONTEXT
      )
      const metadata = result.metadata as Record<string, unknown>
      expect(metadata.buffer).toBe(buffer)
      expect(metadata.date).toBe(date)
      expect(metadata.existing).toBe(existing)
    })

    it('preserves null prototypes and own __proto__ keys without modifying prototypes', async () => {
      const metadata: Record<string, unknown> = Object.create(null)
      metadata.file = STORED_FILE
      const keys = JSON.parse('{"__proto__":{"file":null}}')
      keys.__proto__.file = STORED_FILE
      const result = await FileToolProcessor.processToolOutputs(
        { file: STORED_FILE, metadata, keys },
        TOOL,
        CONTEXT
      )
      expect(Object.getPrototypeOf(result.metadata)).toBeNull()
      const copiedKeys = result.keys as Record<string, unknown>
      expect(Object.getPrototypeOf(copiedKeys)).toBe(Object.prototype)
      expect(Object.hasOwn(copiedKeys, '__proto__')).toBe(true)
      expect((copiedKeys.__proto__ as Record<string, unknown>).file).toBe(result.file)
      expect({}).not.toHaveProperty('file')
    })
  })
})
