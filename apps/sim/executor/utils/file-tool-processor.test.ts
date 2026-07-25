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
})
