import {
  OCI_QUEUE_REQUEST_ID_OUTPUT,
  OCI_QUEUE_STATUS_OUTPUT,
  OCI_QUEUE_WORK_REQUEST_ID_OUTPUT,
  type OciQueueResponse,
  type OciQueueUpdateQueueParams,
} from '@/tools/oci_queue/types'
import { transformOciQueueResponse } from '@/tools/oci_queue/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociQueueUpdateQueueTool: InternalToolConfig<
  OciQueueUpdateQueueParams,
  OciQueueResponse
> = {
  id: 'oci_queue_update_queue',
  name: 'OCI Queue Update Queue',
  description: 'Request queue configuration changes and return the work request.',
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
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Queue display name (1–255 characters); list filtering matches exactly.',
    },
    visibilityInSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Visibility duration: 0–43200 seconds; queue defaults require at least 1. Zero releases a received message.',
    },
    timeoutInSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Long-poll duration: 0–30 seconds. Zero does not wait.',
    },
    deadLetterQueueDeliveryCount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Delivery attempts before dead-lettering: 1–20; 0 disables dead-lettering.',
    },
    channelConsumptionLimit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Channel consumption limit percentage: 1–100.',
    },
    customEncryptionKeyId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional KMS key OCID. An empty string removes it during update.',
    },
    freeformTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Object mapping freeform tag names to string values.',
    },
    definedTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Object mapping tag namespaces to their tag-name/value objects.',
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
      displayName: params.displayName,
      visibilityInSeconds: params.visibilityInSeconds,
      timeoutInSeconds: params.timeoutInSeconds,
      deadLetterQueueDeliveryCount: params.deadLetterQueueDeliveryCount,
      channelConsumptionLimit: params.channelConsumptionLimit,
      customEncryptionKeyId: params.customEncryptionKeyId,
      freeformTags: params.freeformTags,
      definedTags: params.definedTags,
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
