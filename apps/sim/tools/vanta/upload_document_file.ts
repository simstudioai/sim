import type { InternalToolConfig } from '@/tools/types'
import { VANTA_UPLOADED_FILE_OUTPUT_PROPERTIES } from '@/tools/vanta/outputs'
import type {
  VantaUploadDocumentFileParams,
  VantaUploadDocumentFileResponse,
} from '@/tools/vanta/types'
import { createVantaTransformResponse } from '@/tools/vanta/utils'

export const vantaUploadDocumentFileTool: InternalToolConfig<
  VantaUploadDocumentFileParams,
  VantaUploadDocumentFileResponse
> = {
  id: 'vanta_upload_document_file',
  name: 'Vanta Upload Document File',
  description:
    'Upload an evidence file to a Vanta document. Requires credentials with the vanta-api.documents:upload scope.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'vanta',
    credentialKind: 'service-account',
    authoritativeParams: ['apiDomain'],
    retryOnUnauthorized: true,
  },

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
        'MIME type of the file (e.g., application/pdf). Applies only to the base64 upload path; a file from the File input always sends the content type resolved from storage.',
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

  operation: {
    input: (params) => ({
      accessToken: params.accessToken,
      apiDomain: params.apiDomain,
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
