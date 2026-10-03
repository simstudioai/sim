import {
  OCI_NOTIFICATIONS_SUBSCRIPTION_UPDATE_PROPERTIES,
  type OciNotificationsResponse,
  type OciNotificationsUpdateSubscriptionParams,
} from '@/tools/oci_notifications/types'
import { transformOciNotificationsResponse } from '@/tools/oci_notifications/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociNotificationsUpdateSubscriptionTool: InternalToolConfig<
  OciNotificationsUpdateSubscriptionParams,
  OciNotificationsResponse
> = {
  id: 'oci_notifications_update_subscription',
  name: 'OCI Notifications Update Subscription',
  description:
    'Update subscription delivery retry policy and tags; endpoint and protocol are immutable.',
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
    deliveryPolicy: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Delivery retry object: {"backoffRetryPolicy":{"policyType":"EXPONENTIAL","maxRetryDuration":7200000}}. Duration is 60000–7200000 milliseconds.',
    },
    freeformTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Object mapping freeform tag names to string values. Example: {"Department":"Operations"}.',
    },
    definedTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Namespaced string tags. Example: {"Operations":{"CostCenter":"42"}}.',
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
      topicId: params.topicId,
      subscriptionId: params.subscriptionId,
      deliveryPolicy: params.deliveryPolicy,
      freeformTags: params.freeformTags,
      definedTags: params.definedTags,
      ifMatch: params.ifMatch,
    }),
  },
  transformResponse: transformOciNotificationsResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status from Oracle.' },
    requestId: { type: 'string', description: 'Oracle request ID.', optional: true },
    subscriptionUpdate: {
      type: 'object',
      description: 'Updated subscription policy and tags.',
      properties: OCI_NOTIFICATIONS_SUBSCRIPTION_UPDATE_PROPERTIES,
    },
    etag: { type: 'string', description: 'ETag for conditional requests.', optional: true },
  },
}
