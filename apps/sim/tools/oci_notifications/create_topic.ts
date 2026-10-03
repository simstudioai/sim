import {
  OCI_NOTIFICATIONS_TOPIC_PROPERTIES,
  type OciNotificationsCreateTopicParams,
  type OciNotificationsResponse,
} from '@/tools/oci_notifications/types'
import { transformOciNotificationsResponse } from '@/tools/oci_notifications/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociNotificationsCreateTopicTool: InternalToolConfig<
  OciNotificationsCreateTopicParams,
  OciNotificationsResponse
> = {
  id: 'oci_notifications_create_topic',
  name: 'OCI Notifications Create Topic',
  description: 'Create a topic with optional tags and an explicit retry token.',
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
      description:
        'Compartment OCID. For subscriptions, use their current compartment, which may differ from the topic.',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Topic name, unique across the tenancy when creating (maximum 256 characters). List filtering is exact.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Topic description, at most 256 characters. Required for Update Topic; an empty string clears it.',
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
      compartmentId: params.compartmentId,
      name: params.name,
      description: params.description,
      freeformTags: params.freeformTags,
      definedTags: params.definedTags,
      retryToken: params.retryToken,
    }),
  },
  transformResponse: transformOciNotificationsResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status from Oracle.' },
    requestId: { type: 'string', description: 'Oracle request ID.', optional: true },
    topic: {
      type: 'object',
      description: 'Oracle topic configuration.',
      properties: OCI_NOTIFICATIONS_TOPIC_PROPERTIES,
    },
    etag: { type: 'string', description: 'ETag for conditional requests.', optional: true },
  },
}
