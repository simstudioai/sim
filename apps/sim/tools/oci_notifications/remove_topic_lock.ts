import {
  OCI_NOTIFICATIONS_TOPIC_PROPERTIES,
  type OciNotificationsRemoveTopicLockParams,
  type OciNotificationsResponse,
} from '@/tools/oci_notifications/types'
import { transformOciNotificationsResponse } from '@/tools/oci_notifications/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociNotificationsRemoveTopicLockTool: InternalToolConfig<
  OciNotificationsRemoveTopicLockParams,
  OciNotificationsResponse
> = {
  id: 'oci_notifications_remove_topic_lock',
  name: 'OCI Notifications Remove Topic Lock',
  description: 'Remove the specified topic lock using RESOURCE_LOCK_REMOVE permission.',
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
    lock: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Lock object: required type (FULL or DELETE) and compartmentId; optional message, relatedResourceId, timeCreated (RFC3339).',
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
      lock: params.lock,
      ifMatch: params.ifMatch,
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
