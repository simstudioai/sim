import type { InternalToolConfig } from '@/tools/types'
import type {
  VantaDownloadDocumentFileParams,
  VantaDownloadDocumentFileResponse,
} from '@/tools/vanta/types'
import { createVantaTransformResponse } from '@/tools/vanta/utils'

export const vantaDownloadDocumentFileTool: InternalToolConfig<
  VantaDownloadDocumentFileParams,
  VantaDownloadDocumentFileResponse
> = {
  id: 'vanta_download_document_file',
  name: 'Vanta Download Document File',
  description:
    'Download a file previously uploaded to a Vanta evidence document and store it in execution files',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vanta OAuth application client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vanta OAuth application client secret',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Vanta API region: "us" (api.vanta.com, default) or "gov" (api.vanta-gov.com)',
    },
    documentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique ID of the document',
    },
    uploadedFileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique ID of the uploaded file (from List Document Uploads)',
    },
  },

  operation: {
    input: (params) => ({
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      region: params.region,
      documentId: params.documentId,
      uploadedFileId: params.uploadedFileId,
    }),
  },

  transformResponse: createVantaTransformResponse<VantaDownloadDocumentFileResponse>(
    'Failed to download Vanta document file'
  ),

  outputs: {
    file: { type: 'file', description: 'Downloaded file stored in execution files' },
    name: { type: 'string', description: 'Name of the downloaded file' },
    mimeType: { type: 'string', description: 'MIME type of the downloaded file' },
    size: { type: 'number', description: 'Size of the downloaded file in bytes' },
  },
}
