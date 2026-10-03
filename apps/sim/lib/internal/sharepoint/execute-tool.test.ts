import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  upload: vi.fn(),
}))

vi.mock('@/lib/internal/sharepoint/operations', () => ({
  executeSharePointDownloadFile: mocks.download,
  executeSharePointUploadFile: mocks.upload,
}))

import { downloadFileTool } from '@/tools/sharepoint/download_file'
import { uploadFileTool } from '@/tools/sharepoint/upload_file'

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
