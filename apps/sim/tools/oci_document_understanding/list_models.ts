import {
  documentAuthParams,
  documentListParams,
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

export const ociDocumentListModelsTool: InternalToolConfig<OciDocumentParams, OciDocumentResponse> =
  {
    id: 'oci_document_understanding_list_models',
    name: 'OCI Document Understanding List Models',
    description:
      'Discover one page of existing models, optionally within a project. Does not create or train models.',
    version: '1.0.0',
    oauth: documentOAuth,
    params: {
      ...documentAuthParams,
      ...documentListParams,
      projectId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Optional project OCID',
      },
    },
    operation: {
      input: (params) =>
        documentOperationInput(params, [
          'compartmentId',
          'projectId',
          'displayName',
          'lifecycleState',
          'limit',
          'page',
        ]),
    },
    outputs: {
      ...DOCUMENT_REQUEST_ID_OUTPUT,
      models: {
        type: 'array',
        description: 'Model summaries without datasets or training payloads',
        items: { type: 'object', properties: DOCUMENT_MODEL_PROPERTIES },
      },
      nextPage: { type: 'string', description: 'Provider continuation token', nullable: true },
    },
  }
