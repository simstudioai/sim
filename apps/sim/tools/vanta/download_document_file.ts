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

  oauth: { required: true, provider: 'vanta', authoritativeParams: ['apiDomain'] },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token supplied by the saved Vanta credential',
    },
    apiDomain: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'API origin supplied by the saved Vanta credential',
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
      accessToken: params.accessToken,
      apiDomain: params.apiDomain,
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
