/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  exportFile: vi.fn(),
  upload: vi.fn(),
}))

vi.mock('@/lib/internal/google-drive/operations', () => ({
  executeGoogleDriveDownload: mocks.download,
  executeGoogleDriveExport: mocks.exportFile,
  executeGoogleDriveUpload: mocks.upload,
}))

import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { GoogleDriveOperationError } from '@/lib/internal/google-drive/errors'
import { executeGoogleDriveTool } from '@/lib/internal/google-drive/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const INPUTS = {
  google_drive_download: { accessToken: 'token', fileId: 'file-1' },
  google_drive_export: { accessToken: 'token', fileId: 'file-1', mimeType: 'application/pdf' },
  google_drive_upload: {
    accessToken: 'token',
    fileName: 'notes.txt',
    content: 'hello',
  },
} as const

const OPERATIONS = {
  google_drive_download: mocks.download,
  google_drive_export: mocks.exportFile,
  google_drive_upload: mocks.upload,
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

describe('executeGoogleDriveTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const operation of Object.values(OPERATIONS)) {
      operation.mockResolvedValue({ success: true, output: { ok: true } })
    }
  })

  it.each(Object.keys(INPUTS) as Array<keyof typeof INPUTS>)(
    'validates and dispatches %s with trusted context',
    async (toolId) => {
      const controller = new AbortController()
      const response = await executeGoogleDriveTool(request(toolId, { signal: controller.signal }))

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ success: true, output: { ok: true } })
      expect(OPERATIONS[toolId]).toHaveBeenCalledWith(expect.objectContaining(INPUTS[toolId]), {
        requestId: 'request-1',
        signal: controller.signal,
        userId: 'user-1',
      })
    }
  )

  it('preserves validation and provider error envelopes', async () => {
    const invalid = await executeGoogleDriveTool(
      request('google_drive_export', { input: { accessToken: 'token' } })
    )
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toEqual({
      success: false,
      error: 'Invalid input: expected string, received undefined',
    })

    mocks.exportFile.mockRejectedValue(
      new GoogleDriveOperationError(400, { success: false, error: 'Unsupported export' })
    )
    const provider = await executeGoogleDriveTool(request('google_drive_export'))
    expect(provider.status).toBe(400)
    await expect(provider.json()).resolves.toEqual({
      success: false,
      error: 'Unsupported export',
    })
  })

  it('maps oversized export responses to 413', async () => {
    mocks.exportFile.mockRejectedValueOnce(
      new PayloadSizeLimitError({
        label: 'Google Drive export',
        maxBytes: 10,
        observedBytes: 11,
      })
    )

    const response = await executeGoogleDriveTool(request('google_drive_export'))

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('Google Drive export'),
    })
  })

  it('propagates cancellation before and after operation work', async () => {
    const before = new AbortController()
    before.abort(new DOMException('cancelled', 'AbortError'))
    await expect(
      executeGoogleDriveTool(request('google_drive_download', { signal: before.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.download).not.toHaveBeenCalled()

    const after = new AbortController()
    mocks.download.mockImplementationOnce(async () => {
      after.abort(new DOMException('cancelled', 'AbortError'))
      return { success: true }
    })
    await expect(
      executeGoogleDriveTool(request('google_drive_download', { signal: after.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
