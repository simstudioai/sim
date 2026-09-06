import type {
  OciNotificationsDeleteTopicParams,
  OciNotificationsResponse,
} from '@/tools/oci_notifications/types'
import { transformOciNotificationsResponse } from '@/tools/oci_notifications/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociNotificationsDeleteTopicTool: InternalToolConfig<
  OciNotificationsDeleteTopicParams,
  OciNotificationsResponse
> = {
  id: 'oci_notifications_delete_topic',
  name: 'OCI Notifications Delete Topic',
  description: 'Request topic deletion; success does not mean deletion has finished.',
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
      ifMatch: params.ifMatch,
      isLockOverride: params.isLockOverride,
    }),
  },
  transformResponse: transformOciNotificationsResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status from Oracle.' },
    requestId: { type: 'string', description: 'Oracle request ID.', optional: true },
  },
}
