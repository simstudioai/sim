import {
  OCI_QUEUE_REQUEST_ID_OUTPUT,
  OCI_QUEUE_STATUS_OUTPUT,
  OCI_QUEUE_WORK_REQUEST_ID_OUTPUT,
  type OciQueueCreateQueueParams,
  type OciQueueResponse,
} from '@/tools/oci_queue/types'
import { transformOciQueueResponse } from '@/tools/oci_queue/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociQueueCreateQueueTool: InternalToolConfig<
  OciQueueCreateQueueParams,
  OciQueueResponse
> = {
  id: 'oci_queue_create_queue',
  name: 'OCI Queue Create Queue',
  description:
    'Request queue creation and return its work request. An explicit retry token enables at most two tokenized attempts.',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'Compartment OCID. Required to create a queue; optional for API listing.',
    },
    displayName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Queue display name (1–255 characters); list filtering matches exactly.',
    },
    retentionInSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Message retention: 10–604800 seconds. Creation only.',
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
    retryToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional Oracle creation retry token (1–64 characters). Enables two tokenized attempts within the deadline.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      compartmentId: params.compartmentId,
      displayName: params.displayName,
      retentionInSeconds: params.retentionInSeconds,
      visibilityInSeconds: params.visibilityInSeconds,
      timeoutInSeconds: params.timeoutInSeconds,
      deadLetterQueueDeliveryCount: params.deadLetterQueueDeliveryCount,
      channelConsumptionLimit: params.channelConsumptionLimit,
      customEncryptionKeyId: params.customEncryptionKeyId,
      freeformTags: params.freeformTags,
      definedTags: params.definedTags,
      retryToken: params.retryToken,
    }),
  },
  transformResponse: transformOciQueueResponse,
  outputs: {
    status: OCI_QUEUE_STATUS_OUTPUT,
    requestId: OCI_QUEUE_REQUEST_ID_OUTPUT,
    workRequestId: OCI_QUEUE_WORK_REQUEST_ID_OUTPUT,
  },
}
