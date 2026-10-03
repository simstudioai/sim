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

export const ociDocumentListProjectsTool: InternalToolConfig<
  OciDocumentParams,
  OciDocumentResponse
> = {
  id: 'oci_document_understanding_list_projects',
  name: 'OCI Document Understanding List Projects',
  description: 'Discover one page of Document Understanding projects in a compartment.',
  version: '1.0.0',
  oauth: documentOAuth,
  params: { ...documentAuthParams, ...documentListParams },
  operation: {
    input: (params) =>
      documentOperationInput(params, [
        'compartmentId',
        'displayName',
        'lifecycleState',
        'limit',
        'page',
      ]),
  },
  outputs: {
    ...DOCUMENT_REQUEST_ID_OUTPUT,
    projects: {
      type: 'array',
      description: 'Project identity, description, lifecycle and timestamps',
      items: {
        type: 'object',
        properties: {
          id: DOCUMENT_MODEL_PROPERTIES.id,
          displayName: DOCUMENT_MODEL_PROPERTIES.displayName,
          description: DOCUMENT_MODEL_PROPERTIES.description,
          compartmentId: DOCUMENT_MODEL_PROPERTIES.compartmentId,
          lifecycleState: DOCUMENT_MODEL_PROPERTIES.lifecycleState,
          lifecycleDetails: DOCUMENT_MODEL_PROPERTIES.lifecycleDetails,
          timeCreated: DOCUMENT_MODEL_PROPERTIES.timeCreated,
          timeUpdated: DOCUMENT_MODEL_PROPERTIES.timeUpdated,
        },
      },
    },
    nextPage: { type: 'string', description: 'Provider continuation token', nullable: true },
  },
}
