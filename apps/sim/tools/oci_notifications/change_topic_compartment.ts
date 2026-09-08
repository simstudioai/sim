import type {
  OciNotificationsChangeTopicCompartmentParams,
  OciNotificationsResponse,
} from '@/tools/oci_notifications/types'
import { transformOciNotificationsResponse } from '@/tools/oci_notifications/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociNotificationsChangeTopicCompartmentTool: InternalToolConfig<
  OciNotificationsChangeTopicCompartmentParams,
  OciNotificationsResponse
> = {
  id: 'oci_notifications_change_topic_compartment',
  name: 'OCI Notifications Change Topic Compartment',
  description: 'Move a topic within its tenancy; subscriptions stay in their compartments.',
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
    topicId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Topic OCID. Subscription and publish endpoints are discovered with GetTopic; ONS_TOPIC_READ is required.',
    },
    destinationCompartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Destination compartment OCID in the same tenancy. Moving a topic does not move its subscriptions.',
    },
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional ETag for optimistic concurrency.',
    },
    retryToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional Oracle retry token (1–64 characters). Enables at most two tokenized attempts; expires after 24 hours or a conflict.',
    },
    isLockOverride: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Override topic locks for this operation, with appropriate lock permissions. Defaults to false.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      topicId: params.topicId,
      destinationCompartmentId: params.destinationCompartmentId,
      ifMatch: params.ifMatch,
      retryToken: params.retryToken,
      isLockOverride: params.isLockOverride,
    }),
  },
  transformResponse: transformOciNotificationsResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status from Oracle.' },
    requestId: { type: 'string', description: 'Oracle request ID.', optional: true },
  },
}
