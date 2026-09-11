/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PayloadSizeLimitError,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import {
  createInternalToolFileResult,
  createInternalToolFilesResult,
  type InternalToolFile,
} from '@/lib/internal/tool-operations/file-result'
import { MAX_TOOL_RESPONSE_BODY_BYTES } from '@/lib/internal/tool-operations/response-limits'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import type { UserFile } from '@/executor/types'

const mocks = vi.hoisted(() => ({
  uploadExecution: vi.fn(),
  uploadCopilot: vi.fn(),
  deleteFile: vi.fn(),
  deleteMetadata: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/execution', () => ({
  uploadExecutionFile: mocks.uploadExecution,
}))

vi.mock('@/lib/uploads/contexts/copilot', () => ({
  uploadCopilotFile: mocks.uploadCopilot,
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({ deleteFile: mocks.deleteFile }))
vi.mock('@/lib/uploads/server/metadata', () => ({ deleteFileMetadata: mocks.deleteMetadata }))

import {
  presentInternalToolOperationResult,
  storeInternalToolFileResult,
} from '@/lib/internal/tool-operations/file-result.server'

const runContext: InternalToolOperationContext = {
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  userId: 'user-1',
}

const copilotContext: InternalToolOperationContext = {
  workspaceId: 'workspace-1',
  workflowId: '',
  userId: 'user-1',
  copilotToolExecution: true,
}

function file(buffer = Buffer.from('workbook')): InternalToolFile {
  return {
    buffer,
    name: 'workbook.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
}

function storedFile(
  buffer: Buffer,
  name: string,
  type: string,
  context: 'execution' | 'copilot',
  index = 1
): UserFile {
  return {
    id: `file-${index}`,
    key: `${context}/file-${index}/${name}`,
    url: `https://storage.example/file-${index}`,
    name,
    size: buffer.length,
    type,
    context,
  }
}

describe('presentInternalToolOperationResult', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.uploadExecution.mockReset()
    mocks.uploadCopilot.mockReset()
    mocks.deleteFile.mockReset()
    mocks.deleteMetadata.mockReset()
    mocks.uploadExecution.mockImplementation(
      async (_scope: unknown, buffer: Buffer, name: string, type: string) =>
        storedFile(buffer, name, type, 'execution', mocks.uploadExecution.mock.calls.length)
    )
    mocks.uploadCopilot.mockImplementation(
      async (input: { buffer: Buffer; fileName: string; contentType: string }) =>
        storedFile(input.buffer, input.fileName, input.contentType, 'copilot')
    )
    mocks.deleteFile.mockResolvedValue(undefined)
    mocks.deleteMetadata.mockResolvedValue(true)
  })

  it('passes ordinary responses through without reading or changing them', async () => {
    const original = Response.json({ error: 'Provider failed' }, { status: 403 })
    const controller = new AbortController()
    controller.abort()

    const result = await presentInternalToolOperationResult(
      original,
      { workflowId: '' },
      controller.signal
    )

    expect(result).toBe(original)
    expect(original.bodyUsed).toBe(false)
    expect(mocks.uploadExecution).not.toHaveBeenCalled()
    expect(mocks.uploadCopilot).not.toHaveBeenCalled()
  })

  it('persists a 12 MiB workbook before serializing its descriptor and adjacent metadata', async () => {
    const input = file(Buffer.alloc(12 * 1024 * 1024, 1))
    const result = createInternalToolFileResult(
      input,
      (stored) => ({ success: true, output: { file: stored, metadata: { sourceId: 'item-1' } } }),
      { status: 201, headers: { 'x-provider-version': 'v1' } }
    )

    const response = await presentInternalToolOperationResult(result, runContext)
    const body = await response.text()

    expect(body.length).toBeLessThan(1024)
    expect(response.status).toBe(201)
    expect(response.headers.get('x-provider-version')).toBe('v1')
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(JSON.parse(body)).toMatchObject({
      success: true,
      output: {
        file: {
          name: input.name,
          size: input.buffer.length,
          type: input.mimeType,
        },
        metadata: { sourceId: 'item-1' },
      },
    })
    const [scope, buffer, name, mimeType, userId] = mocks.uploadExecution.mock.calls[0]!
    expect(buffer).toBe(input.buffer)
    expect({ scope, name, mimeType, userId }).toEqual({
      scope: { workspaceId: 'workspace-1', workflowId: 'workflow-1', executionId: 'execution-1' },
      name: input.name,
      mimeType: input.mimeType,
      userId: 'user-1',
    })
    expect(mocks.uploadCopilot).not.toHaveBeenCalled()
  })

  it('stores non-run files under the authenticated Copilot user', async () => {
    const input = file()
    const response = await presentInternalToolOperationResult(
      createInternalToolFileResult(input, (stored) => ({ file: stored, fileUrl: stored.url })),
      copilotContext
    )

    expect(await response.json()).toMatchObject({
      file: { context: 'copilot' },
      fileUrl: 'https://storage.example/file-1',
    })
    expect(mocks.uploadCopilot).toHaveBeenCalledWith({
      buffer: input.buffer,
      fileName: input.name,
      contentType: input.mimeType,
      userId: 'user-1',
    })
    expect(mocks.uploadExecution).not.toHaveBeenCalled()
  })

  it('replaces binary representation headers before the JSON transport size check', async () => {
    const input = file(Buffer.alloc(12 * 1024 * 1024))
    const headers = new Headers({
      'content-length': String(input.buffer.length),
      'content-encoding': 'gzip',
      'content-type': input.mimeType,
      'x-provider-version': 'v1',
    })
    const response = await presentInternalToolOperationResult(
      createInternalToolFileResult(input, (stored) => ({ file: stored }), {
        status: 201,
        statusText: 'Created',
        headers,
      }),
      runContext
    )

    const body = await readResponseToBufferWithLimit(response, {
      maxBytes: MAX_TOOL_RESPONSE_BODY_BYTES,
      label: 'Tool response body',
    })

    expect(body.length).toBeLessThan(1024)
    expect(JSON.parse(body.toString('utf8'))).toMatchObject({
      file: { size: input.buffer.length, context: 'execution' },
    })
    expect(response.status).toBe(201)
    expect(response.statusText).toBe('Created')
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('content-length')).toBeNull()
    expect(response.headers.get('content-encoding')).toBeNull()
    expect(response.headers.get('x-provider-version')).toBe('v1')
    expect(headers.get('content-length')).toBe(String(input.buffer.length))
    expect(mocks.uploadExecution).toHaveBeenCalledTimes(1)
    expect(mocks.deleteFile).not.toHaveBeenCalled()
  })

  it('allows actorless execution artifacts without requiring a human subject', async () => {
    const result = createInternalToolFileResult(file(), (stored) => ({ file: stored }))
    await presentInternalToolOperationResult(result, {
      ...runContext,
      userId: undefined,
      executorDelegationOrigin: {
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        principal: {
          kind: 'system',
          serviceId: 'schedule',
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
        },
      },
    })

    expect(mocks.uploadExecution.mock.calls[0]?.[4]).toBeUndefined()
    expect(mocks.uploadCopilot).not.toHaveBeenCalled()
  })

  it("does not make an actorless principal's compatibility owner a Copilot user", async () => {
    await expect(
      presentInternalToolOperationResult(
        createInternalToolFileResult(file(), (stored) => ({ file: stored })),
        {
          ...copilotContext,
          userId: 'billing-owner',
          executorDelegationOrigin: {
            workflowId: 'workflow-1',
            principal: {
              kind: 'system',
              serviceId: 'schedule',
              workspaceId: 'workspace-1',
              workflowId: 'workflow-1',
            },
          },
        }
      )
    ).rejects.toThrow('human subject')
    expect(mocks.uploadCopilot).not.toHaveBeenCalled()
  })

  it('uses a real principal subject and refuses a conflicting claimed owner', async () => {
    const result = createInternalToolFileResult(file(), (stored) => ({ file: stored }))
    const context: InternalToolOperationContext = {
      ...copilotContext,
      userId: undefined,
      executorDelegationOrigin: {
        workflowId: 'workflow-1',
        principal: { kind: 'session', userId: 'actual-user', sessionId: 'session-1' },
      },
    }
    await presentInternalToolOperationResult(result, context)
    expect(mocks.uploadCopilot).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'actual-user' })
    )

    await expect(
      presentInternalToolOperationResult(result, { ...context, userId: 'other-user' })
    ).rejects.toThrow('does not match')
    expect(mocks.uploadCopilot).toHaveBeenCalledTimes(1)
  })

  it.each([
    { ...copilotContext, userId: undefined },
    { ...runContext, workspaceId: undefined },
    { ...runContext, workflowId: '' },
  ])('rejects missing storage authority before uploading: %j', async (context) => {
    await expect(
      presentInternalToolOperationResult(
        createInternalToolFileResult(file(), (stored) => ({ file: stored })),
        context
      )
    ).rejects.toThrow()
    expect(mocks.uploadExecution).not.toHaveBeenCalled()
    expect(mocks.uploadCopilot).not.toHaveBeenCalled()
  })

  it('accepts exactly 100 MiB and rejects larger files before uploading', async () => {
    const atLimit = file(Buffer.alloc(MAX_BUFFERED_TRANSFER_BYTES))
    await presentInternalToolOperationResult(
      createInternalToolFileResult(atLimit, (stored) => ({ file: stored })),
      runContext
    )
    expect(mocks.uploadExecution).toHaveBeenCalledTimes(1)

    const oversized = file(Buffer.alloc(MAX_BUFFERED_TRANSFER_BYTES + 1))
    await expect(
      presentInternalToolOperationResult(
        createInternalToolFileResult(oversized, (stored) => ({ file: stored })),
        runContext
      )
    ).rejects.toBeInstanceOf(PayloadSizeLimitError)
    expect(mocks.uploadExecution).toHaveBeenCalledTimes(1)
  })

  it('checks the aggregate buffer budget before storing the first file', async () => {
    const files = [file(Buffer.alloc(60 * 1024 * 1024)), file(Buffer.alloc(41 * 1024 * 1024))]
    await expect(
      presentInternalToolOperationResult(
        createInternalToolFilesResult(files, (stored) => ({ files: stored })),
        runContext
      )
    ).rejects.toMatchObject({
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
      observedBytes: 101 * 1024 * 1024,
    })
    expect(mocks.uploadExecution).not.toHaveBeenCalled()
  })

  it('validates every file before any upload', async () => {
    await expect(
      presentInternalToolOperationResult(
        createInternalToolFilesResult([file(), { ...file(), name: ' ' }], (stored) => ({
          files: stored,
        })),
        runContext
      )
    ).rejects.toThrow('filename')
    expect(mocks.uploadExecution).not.toHaveBeenCalled()
  })

  it('persists distinct files sequentially and reuses repeated file references', async () => {
    const first = file()
    const second = { ...file(), name: 'second.xlsx' }
    let firstFinished = false
    mocks.uploadExecution
      .mockImplementationOnce(async () => {
        await Promise.resolve()
        firstFinished = true
        return storedFile(first.buffer, first.name, first.mimeType, 'execution')
      })
      .mockImplementationOnce(async () => {
        expect(firstFinished).toBe(true)
        return storedFile(second.buffer, second.name, second.mimeType, 'execution', 2)
      })
    const result = createInternalToolFilesResult([first, second, first], (stored) => {
      expect(stored[0]).toBe(stored[2])
      return { files: stored, echoedFile: stored[0] }
    })

    const response = await presentInternalToolOperationResult(result, runContext)
    expect((await response.json()).files).toHaveLength(3)
    expect(mocks.uploadExecution).toHaveBeenCalledTimes(2)
  })

  it('preserves image sniffing before returning an already stored descriptor', async () => {
    const input = { buffer: Buffer.from('<svg></svg>'), name: 'image.png', mimeType: 'image/png' }
    const response = await presentInternalToolOperationResult(
      createInternalToolFileResult(input, (stored) => ({ file: stored })),
      runContext
    )

    expect(mocks.uploadExecution).toHaveBeenCalledWith(
      expect.anything(),
      input.buffer,
      'image.bin',
      'application/octet-stream',
      'user-1'
    )
    expect(await response.json()).toMatchObject({
      file: {
        name: 'image.bin',
        type: 'application/octet-stream',
      },
    })
  })

  it('does not upload after cancellation', async () => {
    const controller = new AbortController()
    const error = new Error('cancelled')
    controller.abort(error)
    await expect(
      presentInternalToolOperationResult(
        createInternalToolFileResult(file(), (stored) => ({ file: stored })),
        runContext,
        controller.signal
      )
    ).rejects.toBe(error)
    expect(mocks.uploadExecution).not.toHaveBeenCalled()
  })

  it('rolls back an upload that completed after cancellation, without the aborted signal', async () => {
    const controller = new AbortController()
    const error = new Error('cancelled during upload')
    mocks.uploadExecution.mockImplementationOnce(async () => {
      controller.abort(error)
      return storedFile(Buffer.from('file'), 'file.txt', 'text/plain', 'execution')
    })

    await expect(
      presentInternalToolOperationResult(
        createInternalToolFilesResult([file(), file()], (stored) => ({ files: stored })),
        runContext,
        controller.signal
      )
    ).rejects.toBe(error)
    expect(mocks.uploadExecution).toHaveBeenCalledTimes(1)
    expect(mocks.deleteFile).toHaveBeenCalledWith({
      key: 'execution/file-1/file.txt',
      context: 'execution',
    })
    expect(mocks.deleteMetadata).toHaveBeenCalledWith('execution/file-1/file.txt')
  })

  it('rolls back preceding uploads when a later upload fails', async () => {
    const error = new Error('Storage unavailable')
    mocks.uploadExecution
      .mockResolvedValueOnce(
        storedFile(Buffer.from('file'), 'first.txt', 'text/plain', 'execution')
      )
      .mockRejectedValueOnce(error)
    await expect(
      presentInternalToolOperationResult(
        createInternalToolFilesResult([file(), file()], (stored) => ({ files: stored })),
        runContext
      )
    ).rejects.toBe(error)
    expect(mocks.deleteFile).toHaveBeenCalledTimes(1)
    expect(mocks.deleteMetadata).toHaveBeenCalledWith('execution/file-1/first.txt')
  })

  it.each([
    () => {
      throw new Error('Presentation failed')
    },
    () => ({ unsupported: 1n }),
    () => undefined,
  ])('rolls back Copilot files if presentation or serialization fails', async (present) => {
    await expect(
      presentInternalToolOperationResult(
        createInternalToolFileResult(file(), present),
        copilotContext
      )
    ).rejects.toThrow()
    expect(mocks.deleteFile).toHaveBeenCalledWith({
      key: 'copilot/file-1/workbook.xlsx',
      context: 'copilot',
    })
    expect(mocks.deleteMetadata).toHaveBeenCalledWith('copilot/file-1/workbook.xlsx')
  })

  it('rolls back when adjacent JSON exceeds the unchanged transport limit', async () => {
    await expect(
      presentInternalToolOperationResult(
        createInternalToolFileResult(file(), (stored) => ({
          file: stored,
          text: 'x'.repeat(MAX_TOOL_RESPONSE_BODY_BYTES),
        })),
        runContext
      )
    ).rejects.toMatchObject({ maxBytes: MAX_TOOL_RESPONSE_BODY_BYTES })
    expect(mocks.deleteFile).toHaveBeenCalledTimes(1)
    expect(mocks.deleteMetadata).toHaveBeenCalledTimes(1)
  })

  it('finalizes large binary outputs as stored file descriptors', async () => {
    const buffer = Buffer.alloc(12 * 1024 * 1024)
    const finalize = vi.fn((body: unknown) => body)
    const output = await storeInternalToolFileResult(
      createInternalToolFileResult(file(buffer), (stored) => ({
        success: true,
        output: { file: stored },
      })),
      copilotContext,
      finalize
    )

    expect(output).toBe(finalize.mock.calls[0]?.[0])
    expect(output).toMatchObject({
      success: true,
      output: { file: { context: 'copilot', size: buffer.length } },
    })
    expect(output).not.toHaveProperty('output.file.data')
    expect(JSON.stringify(output).length).toBeLessThan(1024)
    expect(mocks.uploadCopilot).toHaveBeenCalledTimes(1)
    expect(mocks.uploadCopilot.mock.calls[0]?.[0].buffer).toBe(buffer)
    expect(mocks.deleteFile).not.toHaveBeenCalled()
  })

  it('rolls back storage if the external result finalizer rejects its output', async () => {
    const error = new Error('Invalid tool response')
    await expect(
      storeInternalToolFileResult(
        createInternalToolFileResult(file(), (stored) => ({ file: stored })),
        copilotContext,
        () => {
          throw error
        }
      )
    ).rejects.toBe(error)

    expect(mocks.deleteFile).toHaveBeenCalledWith({
      key: 'copilot/file-1/workbook.xlsx',
      context: 'copilot',
    })
    expect(mocks.deleteMetadata).toHaveBeenCalledTimes(1)
  })

  it('attempts remaining cleanup after a deletion failure and preserves the original error', async () => {
    const error = new Error('Presentation failed')
    mocks.deleteFile.mockRejectedValueOnce(new Error('Cleanup failed'))
    await expect(
      presentInternalToolOperationResult(
        createInternalToolFilesResult([file(), { ...file(), name: 'second.xlsx' }], () => {
          throw error
        }),
        runContext
      )
    ).rejects.toBe(error)
    expect(mocks.deleteFile).toHaveBeenCalledTimes(2)
    expect(mocks.deleteMetadata).toHaveBeenCalledTimes(1)
    expect(mocks.deleteMetadata).toHaveBeenCalledWith('execution/file-2/second.xlsx')
  })
})
