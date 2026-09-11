/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'
import type { UserFile } from '@/executor/types'
import type { ToolConfig } from '@/tools/types'

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  uploadExecution: vi.fn(),
  uploadCopilot: vi.fn(),
  deleteFile: vi.fn(),
  deleteMetadata: vi.fn(),
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({ downloadFileFromUrl: mocks.download }))
vi.mock('@/lib/uploads/contexts/execution', () => ({ uploadExecutionFile: mocks.uploadExecution }))
vi.mock('@/lib/uploads/contexts/copilot', () => ({ uploadCopilotFile: mocks.uploadCopilot }))
vi.mock('@/lib/uploads/core/storage-service', () => ({ deleteFile: mocks.deleteFile }))
vi.mock('@/lib/uploads/server/metadata', () => ({ deleteFileMetadata: mocks.deleteMetadata }))

import { FileToolProcessor } from '@/executor/utils/file-tool-processor'

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
    mocks.download.mockImplementation(async () => {
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
    expect(mocks.download).toHaveBeenCalledWith('https://example.com/file', {
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
    expect(mocks.download).not.toHaveBeenCalled()
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
    expect(mocks.deleteFile).toHaveBeenCalledWith({ key: stored.key, context: 'copilot' })
    expect(mocks.deleteMetadata).toHaveBeenCalledWith(stored.key)
  })
})
