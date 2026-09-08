import {
  OCI_NOTIFICATIONS_TOPIC_PROPERTIES,
  type OciNotificationsGetTopicParams,
  type OciNotificationsResponse,
} from '@/tools/oci_notifications/types'
import { transformOciNotificationsResponse } from '@/tools/oci_notifications/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociNotificationsGetTopicTool: InternalToolConfig<
  OciNotificationsGetTopicParams,
  OciNotificationsResponse
> = {
  id: 'oci_notifications_get_topic',
  name: 'OCI Notifications Get Topic',
  description: 'Get topic configuration and its subscription/publishing endpoint.',
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
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      topicId: params.topicId,
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
