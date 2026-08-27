/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DocCompileUserError } from '@/lib/copilot/tools/server/files/doc-compile-error'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'

const mocks = vi.hoisted(() => ({ uploadDaytonaFile: vi.fn() }))

vi.mock('@/lib/internal/daytona/operations', () => ({
  uploadDaytonaFile: mocks.uploadDaytonaFile,
}))

import { executeDaytonaTool } from '@/lib/internal/daytona/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

function request(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'daytona_upload_file',
    input: {
      apiKey: 'daytona-key',
      sandboxId: 'sandbox-1',
      destinationPath: '/tmp/',
      fileContent: 'YQ==',
      fileName: 'a.txt',
    },
    headers: new Headers(),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      userId: 'user-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeDaytonaTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.uploadDaytonaFile.mockResolvedValue({
      success: true,
      output: { uploadedPath: '/tmp/a.txt', name: 'a.txt', size: 1 },
    })
  })

  it('dispatches with trusted user identity and cancellation', async () => {
    const controller = new AbortController()
    const response = await executeDaytonaTool(request({ signal: controller.signal }))

    expect(response.status).toBe(200)
    expect(mocks.uploadDaytonaFile).toHaveBeenCalledWith(expect.any(Object), {
      userId: 'user-1',
      requestId: 'request-1',
      signal: controller.signal,
    })
  })

  it('preserves retryable generated-document errors', async () => {
    mocks.uploadDaytonaFile.mockRejectedValueOnce(
      new DocCompileUserError('still compiling', { pending: true })
    )

    const response = await executeDaytonaTool(request())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'A document is still being generated. Wait for it to finish, then try again.',
    })
  })

  it('preserves typed file size errors instead of returning 500', async () => {
    mocks.uploadDaytonaFile.mockRejectedValueOnce(
      new PayloadSizeLimitError({
        label: 'Daytona upload',
        maxBytes: 100,
        observedBytes: 101,
      })
    )

    const response = await executeDaytonaTool(request())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('Daytona upload'),
    })
  })
})
