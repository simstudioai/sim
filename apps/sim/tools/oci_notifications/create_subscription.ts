import {
  OCI_NOTIFICATIONS_SUBSCRIPTION_PROPERTIES,
  type OciNotificationsCreateSubscriptionParams,
  type OciNotificationsResponse,
} from '@/tools/oci_notifications/types'
import { transformOciNotificationsResponse } from '@/tools/oci_notifications/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociNotificationsCreateSubscriptionTool: InternalToolConfig<
  OciNotificationsCreateSubscriptionParams,
  OciNotificationsResponse
> = {
  id: 'oci_notifications_create_subscription',
  name: 'OCI Notifications Create Subscription',
  description:
    'Create a subscription in the parent topic compartment; recipients confirm except for Functions.',
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
    protocol: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'EMAIL, CUSTOM_HTTPS, ORACLE_FUNCTIONS, PAGERDUTY, SLACK, or SMS. Direct publishing does not deliver SMS.',
    },
    endpoint: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Delivery endpoint (maximum 512 characters): email, public HTTPS URL, function OCID, PagerDuty/Slack webhook, or E.164 phone. HTTPS permits Basic authentication but no query parameters or custom headers.',
    },
    metadata: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional subscription metadata string, at most 1024 characters.',
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
      protocol: params.protocol,
      endpoint: params.endpoint,
      metadata: params.metadata,
      freeformTags: params.freeformTags,
      definedTags: params.definedTags,
      retryToken: params.retryToken,
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
