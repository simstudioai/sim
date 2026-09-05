import {
  OCI_QUEUE_NEXT_PAGE_OUTPUT,
  OCI_QUEUE_QUEUES_OUTPUT,
  OCI_QUEUE_REQUEST_ID_OUTPUT,
  OCI_QUEUE_STATUS_OUTPUT,
  type OciQueueListQueuesParams,
  type OciQueueResponse,
} from '@/tools/oci_queue/types'
import { transformOciQueueResponse } from '@/tools/oci_queue/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociQueueListQueuesTool: InternalToolConfig<
  OciQueueListQueuesParams,
  OciQueueResponse
> = {
  id: 'oci_queue_list_queues',
  name: 'OCI Queue List Queues',
  description: 'List one page of OCI queues with exact-name and lifecycle filters.',
  version: '1.0.0',
  params: {
    oauthCredential: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'OCI API-key service account credential ID.',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Optional OCI region; defaults to the saved credential region.',
    },
    compartmentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Compartment OCID. Required to create a queue; optional for API listing.',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Queue display name (1–255 characters); list filtering matches exactly.',
    },
    id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional exact queue OCID filter.',
    },
    lifecycleState: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'CREATING, UPDATING, ACTIVE, DELETING, DELETED, FAILED, or INACTIVE.',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort by timeCreated or displayName.',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ASC or DESC.',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum items in this page (1–1000); receiving accepts only 1–20.',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque nextPage token from a previous response.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      compartmentId: params.compartmentId,
      displayName: params.displayName,
      id: params.id,
      lifecycleState: params.lifecycleState,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
      limit: params.limit,
      page: params.page,
    }),
  },
  transformResponse: transformOciQueueResponse,
  outputs: {
    status: OCI_QUEUE_STATUS_OUTPUT,
    requestId: OCI_QUEUE_REQUEST_ID_OUTPUT,
    nextPage: OCI_QUEUE_NEXT_PAGE_OUTPUT,
    queues: OCI_QUEUE_QUEUES_OUTPUT,
  },
}
