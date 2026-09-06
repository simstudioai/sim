import type {
  OciNotificationsChangeSubscriptionCompartmentParams,
  OciNotificationsResponse,
} from '@/tools/oci_notifications/types'
import { transformOciNotificationsResponse } from '@/tools/oci_notifications/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociNotificationsChangeSubscriptionCompartmentTool: InternalToolConfig<
  OciNotificationsChangeSubscriptionCompartmentParams,
  OciNotificationsResponse
> = {
  id: 'oci_notifications_change_subscription_compartment',
  name: 'OCI Notifications Change Subscription Compartment',
  description: 'Move a subscription within its tenancy without moving its topic.',
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
    subscriptionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Subscription OCID. The topic selects its routing endpoint.',
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
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      topicId: params.topicId,
      subscriptionId: params.subscriptionId,
      destinationCompartmentId: params.destinationCompartmentId,
      ifMatch: params.ifMatch,
      retryToken: params.retryToken,
    }),
  },
  transformResponse: transformOciNotificationsResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status from Oracle.' },
    requestId: { type: 'string', description: 'Oracle request ID.', optional: true },
  },
}
