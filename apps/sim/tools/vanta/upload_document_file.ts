import type { ToolConfig } from '@/tools/types'
import { VANTA_UPLOADED_FILE_OUTPUT_PROPERTIES } from '@/tools/vanta/outputs'
import type {
  VantaUploadDocumentFileParams,
  VantaUploadDocumentFileResponse,
} from '@/tools/vanta/types'
import { createVantaTransformResponse } from '@/tools/vanta/utils'

export const vantaUploadDocumentFileTool: ToolConfig<
  VantaUploadDocumentFileParams,
  VantaUploadDocumentFileResponse
> = {
  id: 'vanta_upload_document_file',
  name: 'Vanta Upload Document File',
  description:
    'Upload an evidence file to a Vanta document. Requires credentials with the vanta-api.documents:upload scope.',
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
      description: 'Unique ID of the document to attach the file to',
    },
    file: {
      type: 'file',
      required: false,
      visibility: 'user-or-llm',
      description: 'The evidence file to upload',
    },
    fileContent: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Base64-encoded file content (alternative to file)',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional file name override',
    },
    mimeType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'MIME type of the file (e.g., application/pdf); used when uploading base64 content, since uploaded files already carry their own type',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the uploaded evidence (e.g., "Q3 access review evidence")',
    },
    effectiveAtDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 8601 date indicating when the document is effective from',
    },
  },

  request: {
    url: '/api/tools/vanta/upload',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      region: params.region,
      documentId: params.documentId,
      file: params.file,
      fileContent: params.fileContent,
      fileName: params.fileName,
      mimeType: params.mimeType,
      description: params.description,
      effectiveAtDate: params.effectiveAtDate,
    }),
  },

  transformResponse: createVantaTransformResponse<VantaUploadDocumentFileResponse>(
    'Failed to upload file to Vanta document'
  ),

  outputs: {
    upload: {
      type: 'json',
      description: 'Metadata of the uploaded file',
      properties: VANTA_UPLOADED_FILE_OUTPUT_PROPERTIES,
    },
  },
}
