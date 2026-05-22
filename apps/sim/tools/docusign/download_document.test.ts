/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { docusignDownloadDocumentTool } from '@/tools/docusign/download_document'

describe('DocuSign download document tool', () => {
  it('forwards execution context to the internal route', () => {
    const body = docusignDownloadDocumentTool.request.body?.({
      accessToken: 'token',
      envelopeId: 'envelope-1',
      documentId: 'combined',
      _context: {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
    })

    expect(body).toMatchObject({
      accessToken: 'token',
      operation: 'download_document',
      envelopeId: 'envelope-1',
      documentId: 'combined',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
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
