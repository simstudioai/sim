import type {
  OciNotificationsPublishMessageParams,
  OciNotificationsResponse,
} from '@/tools/oci_notifications/types'
import { transformOciNotificationsResponse } from '@/tools/oci_notifications/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociNotificationsPublishMessageTool: InternalToolConfig<
  OciNotificationsPublishMessageParams,
  OciNotificationsResponse
> = {
  id: 'oci_notifications_publish_message',
  name: 'OCI Notifications Publish Message',
  description:
    'Publish once to active subscriptions. Acceptance is not delivery; block retries can duplicate messages. Direct SMS is unsupported.',
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
    body: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Message text. Sim caps the entire serialized request at 64,000 UTF-8 bytes. Publish runs once; keep block retries disabled to avoid duplicates.',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional title, at most 255 characters. Used by email and PagerDuty; ignored by HTTPS, Slack, and SMS.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      topicId: params.topicId,
      body: params.body,
      title: params.title,
    }),
  },
  transformResponse: transformOciNotificationsResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status from Oracle.' },
    requestId: { type: 'string', description: 'Oracle request ID.', optional: true },
    messageId: { type: 'string', description: 'Accepted message ID; not a delivery receipt.' },
    timeStamp: {
      type: 'string',
      description: 'RFC3339 service-received timestamp.',
      optional: true,
    },
  },
}
