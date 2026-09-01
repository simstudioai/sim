/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { docusignDownloadDocumentTool } from '@/tools/docusign/download_document'

describe('DocuSign download document tool', () => {
  it('materializes only provider operation input', () => {
    const input = docusignDownloadDocumentTool.operation.input({
      accessToken: 'token',
      envelopeId: 'envelope-1',
      documentId: 'combined',
    })

    expect(docusignDownloadDocumentTool.request).toBeUndefined()
    expect(input).toEqual({
      accessToken: 'token',
      envelopeId: 'envelope-1',
      documentId: 'combined',
    })
  })

  it('returns file outputs from execution-context downloads', async () => {
    const file = {
      id: 'file-1',
      name: 'signed.pdf',
      size: 128,
      type: 'application/pdf',
      url: '/api/files/serve/execution/file-1',
      key: 'execution/workflow/file-1',
      context: 'execution',
    }
    const response = new Response(
      JSON.stringify({
        file,
        mimeType: 'application/pdf',
        fileName: 'signed.pdf',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )

    const result = await docusignDownloadDocumentTool.transformResponse?.(response)

    expect(result?.output).toEqual({
      file,
      mimeType: 'application/pdf',
      fileName: 'signed.pdf',
    })
    expect(result?.output.base64Content).toBeUndefined()
  })
})
