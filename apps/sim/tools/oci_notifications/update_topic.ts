import {
  OCI_NOTIFICATIONS_TOPIC_PROPERTIES,
  type OciNotificationsResponse,
  type OciNotificationsUpdateTopicParams,
} from '@/tools/oci_notifications/types'
import { transformOciNotificationsResponse } from '@/tools/oci_notifications/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociNotificationsUpdateTopicTool: InternalToolConfig<
  OciNotificationsUpdateTopicParams,
  OciNotificationsResponse
> = {
  id: 'oci_notifications_update_topic',
  name: 'OCI Notifications Update Topic',
  description: 'Update topic description and tags without renaming the topic.',
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
    /** The shared required-value validator rejects ''. The server still requires the key. */
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
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional ETag for optimistic concurrency.',
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
      description: params.description,
      freeformTags: params.freeformTags,
      definedTags: params.definedTags,
      ifMatch: params.ifMatch,
      isLockOverride: params.isLockOverride,
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
