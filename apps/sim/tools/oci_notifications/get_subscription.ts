import {
  OCI_NOTIFICATIONS_SUBSCRIPTION_PROPERTIES,
  type OciNotificationsGetSubscriptionParams,
  type OciNotificationsResponse,
} from '@/tools/oci_notifications/types'
import { transformOciNotificationsResponse } from '@/tools/oci_notifications/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociNotificationsGetSubscriptionTool: InternalToolConfig<
  OciNotificationsGetSubscriptionParams,
  OciNotificationsResponse
> = {
  id: 'oci_notifications_get_subscription',
  name: 'OCI Notifications Get Subscription',
  description: 'Get subscription configuration, protocol, and confirmation state.',
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
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      topicId: params.topicId,
      subscriptionId: params.subscriptionId,
    }),
  },
  transformResponse: transformOciNotificationsResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status from Oracle.' },
    requestId: { type: 'string', description: 'Oracle request ID.', optional: true },
    subscription: {
      type: 'object',
      description: 'Oracle subscription configuration.',
      properties: OCI_NOTIFICATIONS_SUBSCRIPTION_PROPERTIES,
    },
    etag: { type: 'string', description: 'ETag for conditional requests.', optional: true },
  },
}
