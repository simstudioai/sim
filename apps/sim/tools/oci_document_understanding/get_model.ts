import {
  documentAuthParams,
  documentOAuth,
  documentOperationInput,
} from '@/tools/oci_document_understanding/shared'
import {
  DOCUMENT_MODEL_PROPERTIES,
  DOCUMENT_REQUEST_ID_OUTPUT,
  type OciDocumentParams,
  type OciDocumentResponse,
} from '@/tools/oci_document_understanding/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDocumentGetModelTool: InternalToolConfig<OciDocumentParams, OciDocumentResponse> = {
  id: 'oci_document_understanding_get_model',
  name: 'OCI Document Understanding Get Model',
  description:
    'Inspect an existing Document Understanding model’s identity, type, language, version and lifecycle.',
  version: '1.0.0',
  oauth: documentOAuth,
  params: {
    ...documentAuthParams,
    modelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Model OCID',
    },
  },
  operation: { input: (params) => documentOperationInput(params, ['modelId']) },
  outputs: {
    ...DOCUMENT_REQUEST_ID_OUTPUT,
    model: {
      type: 'object',
      description: 'Model details without training data',
      properties: DOCUMENT_MODEL_PROPERTIES,
    },
  },
}
