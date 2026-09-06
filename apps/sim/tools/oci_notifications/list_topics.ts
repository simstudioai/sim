import {
  OCI_NOTIFICATIONS_TOPIC_PROPERTIES,
  type OciNotificationsListTopicsParams,
  type OciNotificationsResponse,
} from '@/tools/oci_notifications/types'
import { transformOciNotificationsResponse } from '@/tools/oci_notifications/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociNotificationsListTopicsTool: InternalToolConfig<
  OciNotificationsListTopicsParams,
  OciNotificationsResponse
> = {
  id: 'oci_notifications_list_topics',
  name: 'OCI Notifications List Topics',
  description: 'List topics in one compartment, one page at a time.',
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
    id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional exact topic OCID filter.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Topic name, unique across the tenancy when creating (maximum 256 characters). List filtering is exact.',
    },
    lifecycleState: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter topics by ACTIVE, CREATING, or DELETING.',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'TIMECREATED (default) or LIFECYCLESTATE.',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ASC or DESC. Time-created sorting defaults to DESC.',
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
      compartmentId: params.compartmentId,
      id: params.id,
      name: params.name,
      lifecycleState: params.lifecycleState,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
      limit: params.limit,
      page: params.page,
    }),
  },
  transformResponse: transformOciNotificationsResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status from Oracle.' },
    requestId: { type: 'string', description: 'Oracle request ID.', optional: true },
    nextPage: { type: 'string', description: 'Opaque next-page token.', optional: true },
    topics: {
      type: 'array',
      description: 'One page of topics.',
      items: { type: 'object', properties: OCI_NOTIFICATIONS_TOPIC_PROPERTIES },
    },
  },
}
