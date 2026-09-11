/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { downloadFileTool, downloadFileV2Tool } from '@/tools/ssh/download_file'

const file = {
  id: 'stored-file',
  name: 'file.txt',
  size: 5,
  type: 'text/plain',
  mimeType: 'text/plain',
  url: '/api/files/stored',
  key: 'execution/file.txt',
  context: 'execution',
} as const

describe('SSH download tool versions', () => {
  it('preserves the v1 fileContent alias', async () => {
    const legacyFile = { name: 'file.txt', size: 5, mimeType: 'text/plain', data: 'aGVsbG8=' }
    const response = await downloadFileTool.transformResponse(
      Response.json({ file: legacyFile, content: 'aGVsbG8=', fileName: 'file.txt', size: 5 })
    )
    expect(response.output).toMatchObject({ file: legacyFile, fileContent: 'aGVsbG8=' })
    expect(downloadFileTool.outputs.fileContent).toBeDefined()
  })

  it('presents only the stored file and metadata in v2', async () => {
    const response = await downloadFileV2Tool.transformResponse!(
      Response.json({
        file,
        fileName: 'file.txt',
        remotePath: '/file.txt',
        size: 5,
        message: 'Downloaded',
        content: 'legacy content',
      })
    )
    expect(response).toEqual({
      success: true,
      output: {
        downloaded: true,
        file,
        fileName: 'file.txt',
        remotePath: '/file.txt',
        size: 5,
        message: 'Downloaded',
      },
    })
    expect(downloadFileV2Tool.outputs).not.toHaveProperty('fileContent')
    expect(downloadFileV2Tool.outputs).not.toHaveProperty('content')
    expect(downloadFileV2Tool.operation).toBe(downloadFileTool.operation)
  })
})
