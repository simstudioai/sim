/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { downloadTool } from '@/tools/google_drive/download'
import { exportTool } from '@/tools/google_drive/export'
import { uploadTool } from '@/tools/google_drive/upload'

const TOOLS = [downloadTool, exportTool, uploadTool]

describe('Google Drive internal tool declarations', () => {
  it('exposes operation input without HTTP transport metadata', () => {
    for (const tool of TOOLS) {
      expect(tool.operation.input).toBeTypeOf('function')
      expect(tool).not.toHaveProperty('request')
    }
  })

  it('preserves resolved secrets, dynamic values, and file references verbatim', () => {
    const file = { key: 'workspace/file.txt', name: 'file.txt', size: 4 }
    expect(
      uploadTool.operation.input({
        accessToken: '{{GOOGLE_DRIVE_TOKEN}}',
        fileName: '<agent.fileName>',
        file,
        folderSelector: '<folder.id>',
      })
    ).toEqual({
      accessToken: '{{GOOGLE_DRIVE_TOKEN}}',
      fileName: '<agent.fileName>',
      file,
      content: undefined,
      mimeType: undefined,
      folderId: '<folder.id>',
    })
  })
})
