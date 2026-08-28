/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  upload: vi.fn(),
}))

vi.mock('@/lib/internal/sharepoint/operations', () => ({
  executeSharePointDownloadFile: mocks.download,
  executeSharePointUploadFile: mocks.upload,
}))

import { executeSharePointTool } from '@/lib/internal/sharepoint/execute-tool'
import { downloadFileTool } from '@/tools/sharepoint/download_file'
import { uploadFileTool } from '@/tools/sharepoint/upload_file'

const context = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
}

describe('executeSharePointTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.download.mockResolvedValue(Response.json({ success: true, output: { file: {} } }))
    mocks.upload.mockResolvedValue(Response.json({ success: true, output: { uploadedFiles: [] } }))
  })

  it.each([
    [
      'sharepoint_download_file',
      mocks.download,
      { accessToken: 'token', driveId: 'd', itemId: 'i' },
    ],
    ['sharepoint_upload_file', mocks.upload, { accessToken: 'token', siteId: 'root', files: [] }],
  ])('dispatches %s through its typed operation', async (toolId, operation, input) => {
    await executeSharePointTool({
      toolId,
      input,
      headers: new Headers(),
      context,
      requestId: 'request-1',
    })

    expect(operation).toHaveBeenCalledWith(
      expect.objectContaining(input),
      expect.objectContaining({ userId: 'user-1', requestId: 'request-1' })
    )
  })

  it('requires trusted execution identity before parsing tool input', async () => {
    const response = await executeSharePointTool({
      toolId: 'sharepoint_download_file',
      input: {},
      headers: new Headers(),
      context: {},
      requestId: 'request-1',
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ success: false, error: 'Authentication required' })
    expect(mocks.download).not.toHaveBeenCalled()
  })
})

describe('SharePoint internal tool declarations', () => {
  it('contain operation metadata only and keep private upload data out of model input', () => {
    expect(downloadFileTool).not.toHaveProperty('request')
    expect(uploadFileTool).not.toHaveProperty('request')

    const file = { key: 'workspace/file.pdf', name: 'file.pdf', size: 10 }
    const params = {
      accessToken: 'private-token',
      siteId: 'private-site',
      driveId: 'drive',
      folderPath: '/Reports',
      fileName: 'report.pdf',
      files: [file],
    }
    expect(uploadFileTool.operation.modelInput?.select?.(params)).toEqual({
      driveId: 'drive',
      folderPath: '/Reports',
      fileName: 'report.pdf',
    })
    expect(uploadFileTool.operation.input(params)).toEqual({
      accessToken: 'private-token',
      siteId: 'private-site',
      driveId: 'drive',
      folderPath: '/Reports',
      fileName: 'report.pdf',
      files: [file],
    })
  })
})
