/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { vantaDownloadDocumentFileTool } from '@/tools/vanta/download_document_file'
import { vantaUploadDocumentFileTool } from '@/tools/vanta/upload_document_file'

const TOOLS = [vantaDownloadDocumentFileTool, vantaUploadDocumentFileTool]

describe('Vanta internal tool declarations', () => {
  it('exposes typed operation input without HTTP metadata', () => {
    for (const tool of TOOLS) {
      expect(tool.operation.input).toBeTypeOf('function')
      expect(tool).not.toHaveProperty('request')
    }
  })

  it('leaves mimeType an ordinary operation parameter the base64 path can set', () => {
    expect(vantaUploadDocumentFileTool.params.mimeType.visibility).toBe('user-or-llm')
  })

  it('hides only the system-injected file content', () => {
    expect(vantaUploadDocumentFileTool.params.fileContent.visibility).toBe('hidden')
  })

  it('preserves resolved secrets, variables, and protected file references verbatim', () => {
    const file = { key: 'workspace/file.txt', name: 'file.txt', size: 4 }
    expect(
      vantaUploadDocumentFileTool.operation.input({
        clientId: '{{VANTA_CLIENT_ID}}',
        clientSecret: '{{VANTA_CLIENT_SECRET}}',
        documentId: '<document.id>',
        file,
        fileName: '<agent.fileName>',
      })
    ).toEqual({
      clientId: '{{VANTA_CLIENT_ID}}',
      clientSecret: '{{VANTA_CLIENT_SECRET}}',
      region: undefined,
      documentId: '<document.id>',
      file,
      fileContent: undefined,
      fileName: '<agent.fileName>',
      mimeType: undefined,
      description: undefined,
      effectiveAtDate: undefined,
    })
  })
})
