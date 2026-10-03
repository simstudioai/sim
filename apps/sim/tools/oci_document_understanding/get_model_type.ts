import {
  documentAuthParams,
  documentOAuth,
  documentOperationInput,
} from '@/tools/oci_document_understanding/shared'
import {
  DOCUMENT_REQUEST_ID_OUTPUT,
  type OciDocumentParams,
  type OciDocumentResponse,
} from '@/tools/oci_document_understanding/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDocumentGetModelTypeTool: InternalToolConfig<
  OciDocumentParams,
  OciDocumentResponse
> = {
  id: 'oci_document_understanding_get_model_type',
  name: 'OCI Document Understanding Get Model Type',
  description:
    'Inspect documented model-type versions and capabilities; does not select a hidden analysis API version.',
  version: '1.0.0',
  oauth: documentOAuth,
  params: {
    ...documentAuthParams,
    modelType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Oracle model type',
    },
    modelSubType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional Oracle model subtype filter',
    },
    compartmentId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Optional compartment OCID',
    },
  },
  operation: {
    input: (params) =>
      documentOperationInput(params, ['modelType', 'modelSubType', 'compartmentId']),
  },
  outputs: {
    ...DOCUMENT_REQUEST_ID_OUTPUT,
    versions: { type: 'array', description: 'Documented versions', items: { type: 'string' } },
    capabilities: {
      type: 'array',
      description: 'Flattened provider capability map',
      items: {
        type: 'object',
        properties: {
          version: { type: 'string', description: 'Version key' },
          name: { type: 'string', description: 'Capability name' },
          details: { type: 'array', description: 'Capability details', items: { type: 'string' } },
        },
      },
    },
  },
}
