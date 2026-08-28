/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  downloadOneDriveFile: vi.fn(),
  uploadOneDriveFile: vi.fn(),
}))

vi.mock('@/lib/internal/onedrive/operations', () => ({
  downloadOneDriveFile: mocks.downloadOneDriveFile,
  uploadOneDriveFile: mocks.uploadOneDriveFile,
}))

import { executeOneDriveTool } from '@/lib/internal/onedrive/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

describe('executeOneDriveTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.downloadOneDriveFile.mockResolvedValue({ success: true, output: {} })
    mocks.uploadOneDriveFile.mockResolvedValue({ success: true, output: {} })
  })

  it('dispatches typed input with cancellation', async () => {
    const controller = new AbortController()
    const request: InternalToolOperationCall = {
      toolId: 'onedrive_download',
      input: { accessToken: 'token', fileId: 'file-1' },
      headers: new Headers(),
      context: createExecutionContext(),
      requestId: 'request-1',
      signal: controller.signal,
    }

    expect((await executeOneDriveTool(request)).status).toBe(200)
    expect(mocks.downloadOneDriveFile).toHaveBeenCalledWith(
      { accessToken: 'token', fileId: 'file-1', fileName: undefined },
      { signal: controller.signal }
    )
  })

  it('dispatches uploads with trusted file scope and cancellation', async () => {
    const controller = new AbortController()
    const input = {
      accessToken: 'token',
      fileName: 'notes',
      content: 'hello',
      file: null,
      folderId: null,
      mimeType: null,
      values: null,
    }
    const response = await executeOneDriveTool({
      toolId: 'onedrive_upload',
      input,
      headers: new Headers(),
      context: { ...createExecutionContext(), userId: 'user-1' },
      requestId: 'request-1',
      signal: controller.signal,
    })

    expect(response.status).toBe(200)
    expect(mocks.uploadOneDriveFile).toHaveBeenCalledWith(input, {
      requestId: 'request-1',
      signal: controller.signal,
      userId: 'user-1',
    })
  })
})
