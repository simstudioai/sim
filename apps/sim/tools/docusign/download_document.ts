import type {
  DocuSignDownloadDocumentParams,
  DocuSignDownloadDocumentResponse,
} from '@/tools/docusign/types'
import type { ToolConfig } from '@/tools/types'

export const docusignDownloadDocumentTool: ToolConfig<
  DocuSignDownloadDocumentParams,
  DocuSignDownloadDocumentResponse
> = {
  id: 'docusign_download_document',
  name: 'Download DocuSign Document',
  description: 'Download a signed document from a completed DocuSign envelope',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'docusign',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'DocuSign OAuth access token',
    },
    envelopeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The envelope ID containing the document',
    },
    documentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Specific document ID to download, or "combined" for all documents merged (default: "combined")',
    },
  },

  request: {
    url: '/api/tools/docusign',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      accessToken: params.accessToken,
      operation: 'download_document',
      envelopeId: params.envelopeId,
      documentId: params.documentId,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (data.success === false) {
      throw new Error(data.error || 'Failed to download document')
    }
    return {
      success: true,
      output: {
        base64Content: data.base64Content ?? '',
        mimeType: data.mimeType ?? 'application/pdf',
        fileName: data.fileName ?? 'document.pdf',
      },
    }
  },

  outputs: {
    base64Content: { type: 'string', description: 'Base64-encoded document content' },
    mimeType: { type: 'string', description: 'MIME type of the document' },
    fileName: { type: 'string', description: 'Original file name' },
  },
}
