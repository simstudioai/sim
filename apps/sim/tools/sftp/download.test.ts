/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { sftpDownloadTool, sftpDownloadV2Tool } from '@/tools/sftp/download'

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

describe('SFTP download tool versions', () => {
  it('preserves v1 content and encoding outputs', async () => {
    const legacyFile = { name: 'file.txt', size: 5, mimeType: 'text/plain', data: 'aGVsbG8=' }
    const response = await sftpDownloadTool.transformResponse(
      Response.json({
        file: legacyFile,
        content: 'hello',
        encoding: 'utf-8',
        fileName: 'file.txt',
        size: 5,
      })
    )
    expect(response.output).toMatchObject({ file: legacyFile, content: 'hello', encoding: 'utf-8' })
    expect(sftpDownloadTool.outputs.content).toBeDefined()
    expect(sftpDownloadTool.params.encoding).toBeDefined()
  })

  it('presents only the canonical stored file in v2', async () => {
    const response = await sftpDownloadV2Tool.transformResponse!(
      Response.json({
        file,
        fileName: 'file.txt',
        size: 5,
        message: 'Downloaded',
        content: 'legacy content',
        encoding: 'utf-8',
      })
    )
    expect(response).toEqual({
      success: true,
      output: { file },
    })
    expect(Object.keys(sftpDownloadV2Tool.outputs!)).toEqual(['file'])
    expect(sftpDownloadV2Tool.params).not.toHaveProperty('encoding')
    const input = {
      host: 'sftp.example.com',
      port: 22,
      username: 'user',
      password: 'test-password',
      remotePath: '/file.txt',
      encoding: 'base64',
    }
    expect(sftpDownloadV2Tool.operation.input(input)).not.toHaveProperty('encoding')
  })

  it('reports failure without a duplicate output status in v2', async () => {
    const result = await sftpDownloadV2Tool.transformResponse!(
      Response.json({ success: false, error: 'Missing file' }, { status: 404 })
    )
    expect(result).toEqual({ success: false, output: {}, error: 'Missing file' })
  })
})
