import {
  OCI_NOTIFICATIONS_SUBSCRIPTION_SUMMARY_PROPERTIES,
  type OciNotificationsListSubscriptionsParams,
  type OciNotificationsResponse,
} from '@/tools/oci_notifications/types'
import { transformOciNotificationsResponse } from '@/tools/oci_notifications/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociNotificationsListSubscriptionsTool: InternalToolConfig<
  OciNotificationsListSubscriptionsParams,
  OciNotificationsResponse
> = {
  id: 'oci_notifications_list_subscriptions',
  name: 'OCI Notifications List Subscriptions',
  description:
    'List one page of subscriptions for a topic in the selected subscription compartment.',
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
    compartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Compartment OCID. For subscriptions, use their current compartment, which may differ from the topic.',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum results in this page: 1–50; Oracle defaults to 10.',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque nextPage token from the preceding list response.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      topicId: params.topicId,
      compartmentId: params.compartmentId,
      limit: params.limit,
      page: params.page,
    }),
  },
  transformResponse: transformOciNotificationsResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status from Oracle.' },
    requestId: { type: 'string', description: 'Oracle request ID.', optional: true },
    nextPage: { type: 'string', description: 'Opaque next-page token.', optional: true },
    subscriptions: {
      type: 'array',
      description: 'One page of subscriptions.',
      items: { type: 'object', properties: OCI_NOTIFICATIONS_SUBSCRIPTION_SUMMARY_PROPERTIES },
    },
  },
}
