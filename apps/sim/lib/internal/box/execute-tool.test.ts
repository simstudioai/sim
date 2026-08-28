/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ upload: vi.fn() }))

vi.mock('@/lib/internal/box/operations', () => ({ executeBoxUploadFile: mocks.upload }))

import { executeBoxTool } from '@/lib/internal/box/execute-tool'
import { boxUploadFileTool } from '@/tools/box/upload_file'

const file = { key: 'uploads/file.pdf', name: 'file.pdf', size: 5 }

describe('executeBoxTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.upload.mockResolvedValue(Response.json({ success: true, output: {} }))
  })

  it('dispatches the typed upload with trusted execution context', async () => {
    const controller = new AbortController()
    const input = { accessToken: 'token', parentFolderId: '0', file }
    await executeBoxTool({
      toolId: 'box_upload_file',
      input,
      headers: new Headers(),
      context: { userId: 'user-1' },
      requestId: 'request-1',
      signal: controller.signal,
    })

    expect(mocks.upload).toHaveBeenCalledWith(input, {
      userId: 'user-1',
      requestId: 'request-1',
      signal: controller.signal,
    })
  })

  it('requires trusted identity before parsing', async () => {
    const response = await executeBoxTool({
      toolId: 'box_upload_file',
      input: {},
      headers: new Headers(),
      context: {},
      requestId: 'request-1',
    })

    expect(response.status).toBe(401)
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('uses only typed operation metadata and keeps OAuth and legacy content private', () => {
    expect(boxUploadFileTool).not.toHaveProperty('request')
    const params = {
      accessToken: 'private-token',
      parentFolderId: '0',
      file,
      fileContent: 'private-base64',
      fileName: 'override.pdf',
    }
    expect(boxUploadFileTool.operation.modelInput?.select?.(params)).toEqual({
      parentFolderId: '0',
      file,
      fileName: 'override.pdf',
    })
    expect(boxUploadFileTool.operation.input(params)).toEqual(params)
  })
})
