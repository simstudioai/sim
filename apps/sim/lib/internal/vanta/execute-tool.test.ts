/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  query: vi.fn(),
  upload: vi.fn(),
}))

vi.mock('@/lib/internal/vanta/operations', () => ({
  executeVantaDownloadDocumentFile: mocks.download,
  executeVantaQuery: mocks.query,
  executeVantaUploadDocumentFile: mocks.upload,
}))

import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import { VantaOperationError } from '@/lib/internal/vanta/errors'
import { executeVantaTool } from '@/lib/internal/vanta/execute-tool'

const INPUTS = {
  vanta_download_document_file: {
    clientId: 'client',
    clientSecret: 'secret',
    documentId: 'document-1',
    uploadedFileId: 'upload-1',
  },
  vanta_upload_document_file: {
    clientId: 'client',
    clientSecret: 'secret',
    documentId: 'document-1',
    fileContent: Buffer.from('hello').toString('base64'),
  },
  vanta_list_frameworks: {
    operation: 'vanta_list_frameworks',
    clientId: 'client',
    clientSecret: 'secret',
    pageSize: 25,
  },
} as const

function request(
  toolId: keyof typeof INPUTS,
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId,
    input: INPUTS[toolId],
    headers: new Headers(),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      executionId: 'execution-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeVantaTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.download.mockResolvedValue({ success: true, output: { file: {} } })
    mocks.query.mockResolvedValue({ success: true, output: { frameworks: [] } })
    mocks.upload.mockResolvedValue({ success: true, output: { upload: {} } })
  })

  it.each(Object.keys(INPUTS) as Array<keyof typeof INPUTS>)(
    'validates and dispatches %s with trusted context',
    async (toolId) => {
      const controller = new AbortController()
      const response = await executeVantaTool(request(toolId, { signal: controller.signal }))

      expect(response.status).toBe(200)
      const operation =
        toolId === 'vanta_upload_document_file'
          ? mocks.upload
          : toolId === 'vanta_download_document_file'
            ? mocks.download
            : mocks.query
      if (toolId === 'vanta_list_frameworks') {
        expect(operation).toHaveBeenCalledWith(
          expect.objectContaining(INPUTS[toolId]),
          controller.signal
        )
      } else {
        expect(operation).toHaveBeenCalledWith(expect.objectContaining(INPUTS[toolId]), {
          requestId: 'request-1',
          signal: controller.signal,
          userId: 'user-1',
        })
      }
    }
  )

  it('preserves authentication, validation, and provider errors', async () => {
    const unauthorized = await executeVantaTool(
      request('vanta_upload_document_file', {
        context: createExecutionContext({ workflowId: 'workflow-1' }),
      })
    )
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toEqual({ success: false, error: 'Unauthorized' })

    const invalid = await executeVantaTool(
      request('vanta_download_document_file', { input: { clientId: 'client' } })
    )
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toMatchObject({ error: 'Validation error' })

    mocks.download.mockRejectedValueOnce(
      new VantaOperationError(404, { success: false, error: 'Not found' })
    )
    const provider = await executeVantaTool(request('vanta_download_document_file'))
    expect(provider.status).toBe(404)
    await expect(provider.json()).resolves.toEqual({ success: false, error: 'Not found' })
  })

  it('rejects a query operation that does not match the registered tool ID', async () => {
    const response = await executeVantaTool(
      request('vanta_list_frameworks', {
        input: {
          operation: 'vanta_get_framework',
          clientId: 'client',
          clientSecret: 'secret',
          frameworkId: 'framework-1',
        },
      })
    )

    expect(response.status).toBe(400)
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('propagates cancellation before and after operation work', async () => {
    const before = new AbortController()
    before.abort(new DOMException('cancelled', 'AbortError'))
    await expect(
      executeVantaTool(request('vanta_download_document_file', { signal: before.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.download).not.toHaveBeenCalled()

    const after = new AbortController()
    mocks.download.mockImplementationOnce(async () => {
      after.abort(new DOMException('cancelled', 'AbortError'))
      return { success: true }
    })
    await expect(
      executeVantaTool(request('vanta_download_document_file', { signal: after.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
