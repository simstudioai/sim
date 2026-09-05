import {
  OCI_QUEUE_REQUEST_ID_OUTPUT,
  OCI_QUEUE_STATUS_OUTPUT,
  OCI_QUEUE_WORK_REQUEST_ID_OUTPUT,
  type OciQueueChangeQueueCompartmentParams,
  type OciQueueResponse,
} from '@/tools/oci_queue/types'
import { transformOciQueueResponse } from '@/tools/oci_queue/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociQueueChangeQueueCompartmentTool: InternalToolConfig<
  OciQueueChangeQueueCompartmentParams,
  OciQueueResponse
> = {
  id: 'oci_queue_change_queue_compartment',
  name: 'OCI Queue Change Queue Compartment',
  description: 'Move a queue to another compartment and return its work request.',
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
    queueId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Queue OCID. The message endpoint is discovered from authenticated GetQueue.',
    },
    destinationCompartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Destination compartment OCID.',
    },
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional ETag for optimistic concurrency.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      queueId: params.queueId,
      destinationCompartmentId: params.destinationCompartmentId,
      ifMatch: params.ifMatch,
    }),
  },
  transformResponse: transformOciQueueResponse,
  outputs: {
    status: OCI_QUEUE_STATUS_OUTPUT,
    requestId: OCI_QUEUE_REQUEST_ID_OUTPUT,
    workRequestId: OCI_QUEUE_WORK_REQUEST_ID_OUTPUT,
  },
}
