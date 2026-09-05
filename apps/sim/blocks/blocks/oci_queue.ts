import { NetSuiteIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { parseOptionalNumberInput } from '@/blocks/utils'
import type { OciQueueResponse } from '@/tools/oci_queue/types'

const OPERATION_FIELDS: Readonly<Record<string, readonly string[]>> = {
  oci_queue_list_queues: [
    'compartmentId',
    'displayName',
    'id',
    'lifecycleState',
    'sortBy',
    'sortOrder',
    'limit',
    'page',
  ],
  oci_queue_get_queue: ['queueId'],
  oci_queue_create_queue: [
    'compartmentId',
    'displayName',
    'retentionInSeconds',
    'visibilityInSeconds',
    'timeoutInSeconds',
    'deadLetterQueueDeliveryCount',
    'channelConsumptionLimit',
    'customEncryptionKeyId',
    'freeformTags',
    'definedTags',
    'retryToken',
  ],
  oci_queue_update_queue: [
    'queueId',
    'displayName',
    'visibilityInSeconds',
    'timeoutInSeconds',
    'deadLetterQueueDeliveryCount',
    'channelConsumptionLimit',
    'customEncryptionKeyId',
    'freeformTags',
    'definedTags',
    'ifMatch',
  ],
  oci_queue_delete_queue: ['queueId', 'ifMatch'],
  oci_queue_change_queue_compartment: ['queueId', 'destinationCompartmentId', 'ifMatch'],
  oci_queue_purge_queue: ['queueId', 'purgeType', 'channelIds', 'consumerGroupId', 'ifMatch'],
  oci_queue_put_messages: ['queueId', 'messages'],
  oci_queue_get_messages: [
    'queueId',
    'limit',
    'timeoutInSeconds',
    'visibilityInSeconds',
    'channelFilter',
    'consumerGroupId',
  ],
  oci_queue_delete_message: ['queueId', 'messageReceipt', 'consumerGroupId'],
  oci_queue_delete_messages: ['queueId', 'entries', 'consumerGroupId'],
  oci_queue_update_message: ['queueId', 'messageReceipt', 'visibilityInSeconds', 'consumerGroupId'],
  oci_queue_update_messages: ['queueId', 'entries', 'consumerGroupId'],
  oci_queue_get_stats: ['queueId', 'channelId', 'consumerGroupId'],
  oci_queue_list_channels: ['queueId', 'channelFilter', 'consumerGroupId', 'limit', 'page'],
  oci_queue_list_work_requests: ['compartmentId', 'workRequestId', 'limit', 'page'],
  oci_queue_get_work_request: ['workRequestId'],
  oci_queue_list_work_request_errors: ['workRequestId', 'limit', 'page'],
  oci_queue_list_work_request_logs: ['workRequestId', 'limit', 'page'],
} as const

const NUMERIC_FIELDS = new Set([
  'limit',
  'retentionInSeconds',
  'visibilityInSeconds',
  'timeoutInSeconds',
  'deadLetterQueueDeliveryCount',
  'channelConsumptionLimit',
])
const JSON_FIELDS = new Set(['freeformTags', 'definedTags', 'channelIds', 'messages', 'entries'])

function parseJson(value: unknown, label: string): unknown {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`${label} must be valid JSON`)
  }
}

export const OciQueueBlock: BlockConfig<OciQueueResponse> = {
  type: 'oci_queue',
  name: 'OCI Queue',
  description: 'Manage OCI queues, messages, channels, and work requests',
  longDescription:
    'Connect an OCI API-key service account to manage queues and exchange bounded message batches. Data endpoints are discovered through authenticated GetQueue. Processing uses current receipts for acknowledgement and visibility changes. Receive is one bounded poll; schedule it in a workflow when needed and leave automatic retries disabled for message operations. Queue management returns asynchronous work request IDs. OCI IAM must permit the selected control or message operation and QUEUE_READ for endpoint discovery.',
  docsLink: 'https://docs.sim.ai/integrations/oci_queue',
  authMode: AuthMode.ApiKey,
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  bgColor: '#FFFFFF',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'OCI Queue',
    sentences: {
      byOperation: {
        oci_queue_list_queues: [
          'List queues',
          { text: 'in compartment', field: 'compartmentId' },
          { text: ', up to', field: 'limit' },
        ],
        oci_queue_get_queue: [
          { text: 'Inspect queue', field: ['queueSelector', 'manualQueueId'], core: true },
        ],
        oci_queue_create_queue: [
          { text: 'Create queue', field: 'displayName', core: true },
          { text: 'in compartment', field: 'compartmentId', core: true },
        ],
        oci_queue_update_queue: [
          { text: 'Update queue', field: ['queueSelector', 'manualQueueId'], core: true },
        ],
        oci_queue_delete_queue: [
          { text: 'Delete queue', field: ['queueSelector', 'manualQueueId'], core: true },
        ],
        oci_queue_change_queue_compartment: [
          { text: 'Move queue', field: ['queueSelector', 'manualQueueId'], core: true },
          { text: 'to compartment', field: 'destinationCompartmentId', core: true },
        ],
        oci_queue_purge_queue: [
          { text: 'Purge', field: 'purgeType', core: true },
          { text: 'messages from', field: ['queueSelector', 'manualQueueId'], core: true },
        ],
        oci_queue_put_messages: [
          { text: 'Send', field: 'messages', core: true },
          { text: 'to queue', field: ['queueSelector', 'manualQueueId'], core: true },
        ],
        oci_queue_get_messages: [
          { text: 'Receive from', field: ['queueSelector', 'manualQueueId'], core: true },
          { text: ', up to', field: 'limit' },
          { text: ', waiting', field: 'timeoutInSeconds', after: 'seconds' },
        ],
        oci_queue_delete_message: [
          { text: 'Acknowledge receipt', field: 'messageReceipt', core: true },
          { text: 'in queue', field: ['queueSelector', 'manualQueueId'], core: true },
        ],
        oci_queue_delete_messages: [
          { text: 'Acknowledge', field: 'entries', core: true },
          { text: 'in queue', field: ['queueSelector', 'manualQueueId'], core: true },
        ],
        oci_queue_update_message: [
          { text: 'Set receipt', field: 'messageReceipt', core: true },
          { text: 'visibility to seconds', field: 'visibilityInSeconds', core: true },
        ],
        oci_queue_update_messages: [
          { text: 'Update visibility for', field: 'entries', core: true },
          { text: 'in queue', field: ['queueSelector', 'manualQueueId'], core: true },
        ],
        oci_queue_get_stats: [
          { text: 'Inspect statistics for', field: ['queueSelector', 'manualQueueId'], core: true },
        ],
        oci_queue_list_channels: [
          { text: 'List channels in', field: ['queueSelector', 'manualQueueId'], core: true },
        ],
        oci_queue_list_work_requests: [
          'List work requests',
          { text: 'in compartment', field: 'compartmentId' },
        ],
        oci_queue_get_work_request: [
          { text: 'Inspect work request', field: 'workRequestId', core: true },
        ],
        oci_queue_list_work_request_errors: [
          { text: 'List errors for work request', field: 'workRequestId', core: true },
        ],
        oci_queue_list_work_request_logs: [
          { text: 'List logs for work request', field: 'workRequestId', core: true },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'credential',
      title: 'OCI Account',
      type: 'oauth-input',
      serviceId: 'oci-queue',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'OCI Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Queues', id: 'oci_queue_list_queues' },
        { label: 'Get Queue', id: 'oci_queue_get_queue' },
        { label: 'Create Queue', id: 'oci_queue_create_queue' },
        { label: 'Update Queue', id: 'oci_queue_update_queue' },
        { label: 'Delete Queue', id: 'oci_queue_delete_queue' },
        { label: 'Change Queue Compartment', id: 'oci_queue_change_queue_compartment' },
        { label: 'Purge Queue', id: 'oci_queue_purge_queue' },
        { label: 'Put Messages', id: 'oci_queue_put_messages' },
        { label: 'Get Messages', id: 'oci_queue_get_messages' },
        { label: 'Delete Message', id: 'oci_queue_delete_message' },
        { label: 'Delete Messages', id: 'oci_queue_delete_messages' },
        { label: 'Update Message', id: 'oci_queue_update_message' },
        { label: 'Update Messages', id: 'oci_queue_update_messages' },
        { label: 'Get Statistics', id: 'oci_queue_get_stats' },
        { label: 'List Channels', id: 'oci_queue_list_channels' },
        { label: 'List Work Requests', id: 'oci_queue_list_work_requests' },
        { label: 'Get Work Request', id: 'oci_queue_get_work_request' },
        { label: 'List Work Request Errors', id: 'oci_queue_list_work_request_errors' },
        { label: 'List Work Request Logs', id: 'oci_queue_list_work_request_logs' },
      ],
      value: () => 'oci_queue_list_queues',
      required: true,
    },
    {
      id: 'region',
      title: 'Region',
      type: 'short-input',
      placeholder: 'Saved credential region',
    },
    {
      id: 'compartmentId',
      title: 'Compartment ID',
      type: 'short-input',
      placeholder: 'Compartment OCID (also used for queue selection)',
      condition: {
        field: 'operation',
        value: [
          'oci_queue_list_queues',
          'oci_queue_create_queue',
          'oci_queue_list_work_requests',
          'oci_queue_get_queue',
          'oci_queue_update_queue',
          'oci_queue_delete_queue',
          'oci_queue_change_queue_compartment',
          'oci_queue_purge_queue',
          'oci_queue_put_messages',
          'oci_queue_get_messages',
          'oci_queue_delete_message',
          'oci_queue_delete_messages',
          'oci_queue_update_message',
          'oci_queue_update_messages',
          'oci_queue_get_stats',
          'oci_queue_list_channels',
        ],
      },
      required: { field: 'operation', value: 'oci_queue_create_queue' },
    },
    {
      id: 'queueSelector',
      title: 'Queue',
      type: 'project-selector',
      canonicalParamId: 'queueId',
      serviceId: 'oci-queue',
      selectorKey: 'oci_queue.queues',
      dependsOn: ['credential', 'compartmentId', 'region'],
      placeholder: 'Select queue',
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'oci_queue_get_queue',
          'oci_queue_update_queue',
          'oci_queue_delete_queue',
          'oci_queue_change_queue_compartment',
          'oci_queue_purge_queue',
          'oci_queue_put_messages',
          'oci_queue_get_messages',
          'oci_queue_delete_message',
          'oci_queue_delete_messages',
          'oci_queue_update_message',
          'oci_queue_update_messages',
          'oci_queue_get_stats',
          'oci_queue_list_channels',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oci_queue_get_queue',
          'oci_queue_update_queue',
          'oci_queue_delete_queue',
          'oci_queue_change_queue_compartment',
          'oci_queue_purge_queue',
          'oci_queue_put_messages',
          'oci_queue_get_messages',
          'oci_queue_delete_message',
          'oci_queue_delete_messages',
          'oci_queue_update_message',
          'oci_queue_update_messages',
          'oci_queue_get_stats',
          'oci_queue_list_channels',
        ],
      },
    },
    {
      id: 'manualQueueId',
      title: 'Queue',
      type: 'short-input',
      canonicalParamId: 'queueId',
      placeholder: 'Queue ID',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oci_queue_get_queue',
          'oci_queue_update_queue',
          'oci_queue_delete_queue',
          'oci_queue_change_queue_compartment',
          'oci_queue_purge_queue',
          'oci_queue_put_messages',
          'oci_queue_get_messages',
          'oci_queue_delete_message',
          'oci_queue_delete_messages',
          'oci_queue_update_message',
          'oci_queue_update_messages',
          'oci_queue_get_stats',
          'oci_queue_list_channels',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oci_queue_get_queue',
          'oci_queue_update_queue',
          'oci_queue_delete_queue',
          'oci_queue_change_queue_compartment',
          'oci_queue_purge_queue',
          'oci_queue_put_messages',
          'oci_queue_get_messages',
          'oci_queue_delete_message',
          'oci_queue_delete_messages',
          'oci_queue_update_message',
          'oci_queue_update_messages',
          'oci_queue_get_stats',
          'oci_queue_list_channels',
        ],
      },
    },
    {
      id: 'channelSelector',
      title: 'Channel',
      type: 'project-selector',
      canonicalParamId: 'channelId',
      serviceId: 'oci-queue',
      selectorKey: 'oci_queue.channels',
      dependsOn: ['credential', 'queueSelector', 'region', 'consumerGroupId'],
      placeholder: 'Select channel',
      mode: 'basic',
      condition: {
        field: 'operation',
        value: ['oci_queue_get_messages', 'oci_queue_get_stats', 'oci_queue_list_channels'],
      },
      required: false,
    },
    {
      id: 'manualChannelId',
      title: 'Channel',
      type: 'short-input',
      canonicalParamId: 'channelId',
      placeholder: 'Channel ID',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oci_queue_get_messages', 'oci_queue_get_stats', 'oci_queue_list_channels'],
      },
      required: false,
    },
    {
      id: 'displayName',
      title: 'Display Name',
      type: 'short-input',
      placeholder: 'Queue display name (1–255 characters); list filtering matches exactly.',
      condition: {
        field: 'operation',
        value: ['oci_queue_list_queues', 'oci_queue_create_queue', 'oci_queue_update_queue'],
      },
      required: { field: 'operation', value: ['oci_queue_create_queue'] },
    },
    {
      id: 'id',
      mode: 'advanced',
      title: 'Queue ID Filter',
      type: 'short-input',
      placeholder: 'Optional exact queue OCID filter.',
      condition: { field: 'operation', value: ['oci_queue_list_queues'] },
    },
    {
      id: 'lifecycleState',
      mode: 'advanced',
      title: 'Lifecycle State',
      type: 'dropdown',
      options: [
        { label: 'CREATING', id: 'CREATING' },
        { label: 'UPDATING', id: 'UPDATING' },
        { label: 'ACTIVE', id: 'ACTIVE' },
        { label: 'DELETING', id: 'DELETING' },
        { label: 'DELETED', id: 'DELETED' },
        { label: 'FAILED', id: 'FAILED' },
        { label: 'INACTIVE', id: 'INACTIVE' },
      ],
      condition: { field: 'operation', value: ['oci_queue_list_queues'] },
    },
    {
      id: 'sortBy',
      mode: 'advanced',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'timeCreated', id: 'timeCreated' },
        { label: 'displayName', id: 'displayName' },
      ],
      condition: { field: 'operation', value: ['oci_queue_list_queues'] },
    },
    {
      id: 'sortOrder',
      mode: 'advanced',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { label: 'ASC', id: 'ASC' },
        { label: 'DESC', id: 'DESC' },
      ],
      condition: { field: 'operation', value: ['oci_queue_list_queues'] },
    },
    {
      id: 'limit',
      mode: 'advanced',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Maximum items in this page (1–1000); receiving accepts only 1–20.',
      condition: {
        field: 'operation',
        value: [
          'oci_queue_list_queues',
          'oci_queue_get_messages',
          'oci_queue_list_channels',
          'oci_queue_list_work_requests',
          'oci_queue_list_work_request_errors',
          'oci_queue_list_work_request_logs',
        ],
      },
    },
    {
      id: 'page',
      mode: 'advanced',
      title: 'Page',
      type: 'short-input',
      placeholder: 'Opaque nextPage token from a previous response.',
      condition: {
        field: 'operation',
        value: [
          'oci_queue_list_queues',
          'oci_queue_list_channels',
          'oci_queue_list_work_requests',
          'oci_queue_list_work_request_errors',
          'oci_queue_list_work_request_logs',
        ],
      },
    },
    {
      id: 'retentionInSeconds',
      mode: 'advanced',
      title: 'Retention In Seconds',
      type: 'short-input',
      placeholder: 'Message retention: 10–604800 seconds. Creation only.',
      condition: { field: 'operation', value: ['oci_queue_create_queue'] },
    },
    {
      id: 'visibilityInSeconds',
      title: 'Visibility In Seconds',
      type: 'short-input',
      placeholder:
        'Visibility duration: 0–43200 seconds; queue defaults require at least 1. Zero releases a received message.',
      condition: {
        field: 'operation',
        value: [
          'oci_queue_create_queue',
          'oci_queue_update_queue',
          'oci_queue_get_messages',
          'oci_queue_update_message',
        ],
      },
      required: { field: 'operation', value: ['oci_queue_update_message'] },
    },
    {
      id: 'timeoutInSeconds',
      title: 'Timeout In Seconds',
      type: 'short-input',
      placeholder: 'Long-poll duration: 0–30 seconds. Zero does not wait.',
      condition: {
        field: 'operation',
        value: ['oci_queue_create_queue', 'oci_queue_update_queue', 'oci_queue_get_messages'],
      },
    },
    {
      id: 'deadLetterQueueDeliveryCount',
      mode: 'advanced',
      title: 'Dead Letter Queue Delivery Count',
      type: 'short-input',
      placeholder: 'Delivery attempts before dead-lettering: 1–20; 0 disables dead-lettering.',
      condition: {
        field: 'operation',
        value: ['oci_queue_create_queue', 'oci_queue_update_queue'],
      },
    },
    {
      id: 'channelConsumptionLimit',
      mode: 'advanced',
      title: 'Channel Consumption Limit',
      type: 'short-input',
      placeholder: 'Channel consumption limit percentage: 1–100.',
      condition: {
        field: 'operation',
        value: ['oci_queue_create_queue', 'oci_queue_update_queue'],
      },
    },
    {
      id: 'customEncryptionKeyId',
      mode: 'advanced',
      title: 'Custom Encryption Key Id',
      type: 'short-input',
      placeholder: 'Optional KMS key OCID. An empty string removes it during update.',
      condition: {
        field: 'operation',
        value: ['oci_queue_create_queue', 'oci_queue_update_queue'],
      },
    },
    {
      id: 'freeformTags',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate OCI Queue freeformTags as JSON. Use only supplied receipts and documented fields. Example: {"team":"operations"}. Return ONLY valid JSON.',
        placeholder: 'Describe the freeformTags to prepare',
        generationType: 'json-object',
      },
      mode: 'advanced',
      title: 'Freeform Tags',
      type: 'long-input',
      placeholder: 'Object mapping freeform tag names to string values.',
      condition: {
        field: 'operation',
        value: ['oci_queue_create_queue', 'oci_queue_update_queue'],
      },
    },
    {
      id: 'definedTags',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate OCI Queue definedTags as JSON. Use only supplied receipts and documented fields. Example: {"Operations":{"CostCenter":"42"}}. Return ONLY valid JSON.',
        placeholder: 'Describe the definedTags to prepare',
        generationType: 'json-object',
      },
      mode: 'advanced',
      title: 'Defined Tags',
      type: 'long-input',
      placeholder: 'Object mapping tag namespaces to their tag-name/value objects.',
      condition: {
        field: 'operation',
        value: ['oci_queue_create_queue', 'oci_queue_update_queue'],
      },
    },
    {
      id: 'retryToken',
      mode: 'advanced',
      title: 'Creation Retry Token',
      type: 'short-input',
      placeholder:
        'Optional Oracle creation retry token (1–64 characters). Enables two tokenized attempts within the deadline.',
      condition: { field: 'operation', value: ['oci_queue_create_queue'] },
    },
    {
      id: 'ifMatch',
      mode: 'advanced',
      title: 'If Match',
      type: 'short-input',
      placeholder: 'Optional ETag for optimistic concurrency.',
      condition: {
        field: 'operation',
        value: [
          'oci_queue_update_queue',
          'oci_queue_delete_queue',
          'oci_queue_change_queue_compartment',
          'oci_queue_purge_queue',
        ],
      },
    },
    {
      id: 'destinationCompartmentId',
      title: 'Destination Compartment ID',
      type: 'short-input',
      placeholder: 'Destination compartment OCID.',
      condition: { field: 'operation', value: ['oci_queue_change_queue_compartment'] },
      required: { field: 'operation', value: ['oci_queue_change_queue_compartment'] },
    },
    {
      id: 'purgeType',
      title: 'Purge Type',
      type: 'dropdown',
      options: [
        { label: 'NORMAL', id: 'NORMAL' },
        { label: 'DLQ', id: 'DLQ' },
        { label: 'BOTH', id: 'BOTH' },
      ],
      condition: { field: 'operation', value: ['oci_queue_purge_queue'] },
      required: { field: 'operation', value: ['oci_queue_purge_queue'] },
    },
    {
      id: 'channelIds',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate OCI Queue channelIds as JSON. Use only supplied receipts and documented fields. Example: ["jobs","billing"]. Return ONLY valid JSON.',
        placeholder: 'Describe the channelIds to prepare',
        generationType: 'json-array',
      },
      title: 'Channels to Purge',
      type: 'long-input',
      placeholder: 'Optional array of channel IDs to purge; omit for all channels.',
      condition: { field: 'operation', value: ['oci_queue_purge_queue'] },
    },
    {
      id: 'consumerGroupId',
      title: 'Consumer Group ID',
      type: 'short-input',
      placeholder:
        'Optional existing consumer group ID where Oracle supports it. Omit for the primary group.',
      condition: {
        field: 'operation',
        value: [
          'oci_queue_purge_queue',
          'oci_queue_get_messages',
          'oci_queue_delete_message',
          'oci_queue_delete_messages',
          'oci_queue_update_message',
          'oci_queue_update_messages',
          'oci_queue_get_stats',
          'oci_queue_list_channels',
        ],
      },
    },
    {
      id: 'messages',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate OCI Queue messages as JSON. Use only supplied receipts and documented fields. Example: [{"content":"hello","metadata":{"channelId":"jobs"}}]. Return ONLY valid JSON.',
        placeholder: 'Describe the messages to prepare',
        generationType: 'json-array',
      },
      title: 'Messages',
      type: 'long-input',
      placeholder:
        'Array of 1–20 {content, metadata?: {channelId, customProperties?}} messages. UTF-8 content is at most 256 KiB each; serialized batch is at most 512 KiB.',
      condition: { field: 'operation', value: ['oci_queue_put_messages'] },
      required: { field: 'operation', value: ['oci_queue_put_messages'] },
    },
    {
      id: 'messageReceipt',
      title: 'Message Receipt',
      type: 'short-input',
      placeholder:
        'Exact current receipt returned by Get Messages. Preserve whitespace and punctuation; do not use the message ID.',
      condition: {
        field: 'operation',
        value: ['oci_queue_delete_message', 'oci_queue_update_message'],
      },
      required: {
        field: 'operation',
        value: ['oci_queue_delete_message', 'oci_queue_update_message'],
      },
    },
    {
      id: 'entries',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate OCI Queue entries as JSON. Use only supplied receipts and documented fields. Example: [{"receipt":"CURRENT_RECEIPT"}] for acknowledgement or [{"receipt":"CURRENT_RECEIPT","visibilityInSeconds":30}] for visibility updates. Return ONLY valid JSON.',
        placeholder: 'Describe the entries to prepare',
        generationType: 'json-array',
      },
      title: 'Batch Entries',
      type: 'long-input',
      placeholder:
        'Array of 1–20 entries: {receipt} for deletion or {receipt, visibilityInSeconds} for visibility changes.',
      condition: {
        field: 'operation',
        value: ['oci_queue_delete_messages', 'oci_queue_update_messages'],
      },
      required: {
        field: 'operation',
        value: ['oci_queue_delete_messages', 'oci_queue_update_messages'],
      },
    },
    {
      id: 'workRequestId',
      title: 'Work Request Id',
      type: 'short-input',
      placeholder: 'Queue work request OCID.',
      condition: {
        field: 'operation',
        value: [
          'oci_queue_list_work_requests',
          'oci_queue_get_work_request',
          'oci_queue_list_work_request_errors',
          'oci_queue_list_work_request_logs',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oci_queue_get_work_request',
          'oci_queue_list_work_request_errors',
          'oci_queue_list_work_request_logs',
        ],
      },
    },
  ],
  tools: {
    access: [
      'oci_queue_list_queues',
      'oci_queue_get_queue',
      'oci_queue_create_queue',
      'oci_queue_update_queue',
      'oci_queue_delete_queue',
      'oci_queue_change_queue_compartment',
      'oci_queue_purge_queue',
      'oci_queue_put_messages',
      'oci_queue_get_messages',
      'oci_queue_delete_message',
      'oci_queue_delete_messages',
      'oci_queue_update_message',
      'oci_queue_update_messages',
      'oci_queue_get_stats',
      'oci_queue_list_channels',
      'oci_queue_list_work_requests',
      'oci_queue_get_work_request',
      'oci_queue_list_work_request_errors',
      'oci_queue_list_work_request_logs',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        if (typeof params.operation !== 'string') return {}
        const fields = OPERATION_FIELDS[params.operation]
        if (!fields) return {}
        const result: Record<string, unknown> = {
          oauthCredential: params.oauthCredential,
          region: params.region || undefined,
        }
        for (const field of fields) {
          const value = field === 'channelFilter' ? params.channelId : params[field]
          const removeEncryptionKey =
            field === 'customEncryptionKeyId' && params.operation === 'oci_queue_update_queue'
          result[field] =
            value === null || value === undefined || (value === '' && !removeEncryptionKey)
              ? undefined
              : JSON_FIELDS.has(field)
                ? parseJson(value, field)
                : NUMERIC_FIELDS.has(field)
                  ? parseOptionalNumberInput(value, field, { integer: true })
                  : value
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'OCI Queue operation.' },
    oauthCredential: { type: 'string', description: 'OCI API-key service account credential ID.' },
    region: {
      type: 'string',
      description: 'Optional OCI region; defaults to the saved credential region.',
    },
    queueId: {
      type: 'string',
      description: 'Queue OCID. The message endpoint is discovered from authenticated GetQueue.',
    },
    compartmentId: {
      type: 'string',
      description: 'Compartment OCID. Required to create a queue; optional for API listing.',
    },
    displayName: {
      type: 'string',
      description: 'Queue display name (1–255 characters); list filtering matches exactly.',
    },
    id: { type: 'string', description: 'Optional exact queue OCID filter.' },
    lifecycleState: {
      type: 'string',
      description: 'CREATING, UPDATING, ACTIVE, DELETING, DELETED, FAILED, or INACTIVE.',
    },
    sortBy: { type: 'string', description: 'Sort by timeCreated or displayName.' },
    sortOrder: { type: 'string', description: 'ASC or DESC.' },
    limit: {
      type: 'number',
      description: 'Maximum items in this page (1–1000); receiving accepts only 1–20.',
    },
    page: { type: 'string', description: 'Opaque nextPage token from a previous response.' },
    retentionInSeconds: {
      type: 'number',
      description: 'Message retention: 10–604800 seconds. Creation only.',
    },
    visibilityInSeconds: {
      type: 'number',
      description:
        'Visibility duration: 0–43200 seconds; queue defaults require at least 1. Zero releases a received message.',
    },
    timeoutInSeconds: {
      type: 'number',
      description: 'Long-poll duration: 0–30 seconds. Zero does not wait.',
    },
    deadLetterQueueDeliveryCount: {
      type: 'number',
      description: 'Delivery attempts before dead-lettering: 1–20; 0 disables dead-lettering.',
    },
    channelConsumptionLimit: {
      type: 'number',
      description: 'Channel consumption limit percentage: 1–100.',
    },
    customEncryptionKeyId: {
      type: 'string',
      description: 'Optional KMS key OCID. An empty string removes it during update.',
    },
    freeformTags: {
      type: 'json',
      description: 'Object mapping freeform tag names to string values.',
    },
    definedTags: {
      type: 'json',
      description: 'Object mapping tag namespaces to their tag-name/value objects.',
    },
    retryToken: {
      type: 'string',
      description:
        'Optional Oracle creation retry token (1–64 characters). Enables two tokenized attempts within the deadline.',
    },
    ifMatch: { type: 'string', description: 'Optional ETag for optimistic concurrency.' },
    destinationCompartmentId: { type: 'string', description: 'Destination compartment OCID.' },
    purgeType: {
      type: 'string',
      description: 'NORMAL, DLQ, or BOTH. Purging is asynchronous and is not retried.',
    },
    channelIds: {
      type: 'json',
      description: 'Optional array of channel IDs to purge; omit for all channels.',
    },
    consumerGroupId: {
      type: 'string',
      description:
        'Optional existing consumer group ID where Oracle supports it. Omit for the primary group.',
    },
    messages: {
      type: 'json',
      description:
        'Array of 1–20 {content, metadata?: {channelId, customProperties?}} messages. UTF-8 content is at most 256 KiB each; serialized batch is at most 512 KiB.',
    },
    channelId: { type: 'string', description: 'Optional channel ID for statistics.' },
    messageReceipt: {
      type: 'string',
      description:
        'Exact current receipt returned by Get Messages. Preserve whitespace and punctuation; do not use the message ID.',
    },
    entries: {
      type: 'json',
      description:
        'Array of 1–20 entries: {receipt} for deletion or {receipt, visibilityInSeconds} for visibility changes.',
    },
    workRequestId: { type: 'string', description: 'Queue work request OCID.' },
  },
  outputs: {
    status: { type: 'number', description: 'HTTP status from Oracle.' },
    requestId: { type: 'string', description: 'Oracle request ID when returned.' },
    queues: {
      type: 'array',
      description: 'One page of queue summaries.',
      condition: { field: 'operation', value: ['oci_queue_list_queues'] },
    },
    queue: {
      type: 'json',
      description: 'Queue configuration and capability names.',
      condition: { field: 'operation', value: ['oci_queue_get_queue'] },
    },
    workRequestId: {
      type: 'string',
      description: 'Accepted asynchronous work request ID.',
      condition: {
        field: 'operation',
        value: [
          'oci_queue_create_queue',
          'oci_queue_update_queue',
          'oci_queue_delete_queue',
          'oci_queue_change_queue_compartment',
          'oci_queue_purge_queue',
        ],
      },
    },
    etag: {
      type: 'string',
      description: 'Queue ETag.',
      condition: { field: 'operation', value: ['oci_queue_get_queue'] },
    },
    nextPage: {
      type: 'string',
      description: 'Opaque next-page token.',
      condition: {
        field: 'operation',
        value: [
          'oci_queue_list_queues',
          'oci_queue_list_channels',
          'oci_queue_list_work_requests',
          'oci_queue_list_work_request_errors',
          'oci_queue_list_work_request_logs',
        ],
      },
    },
    messages: {
      type: 'array',
      description:
        'Published or received messages with lossless string IDs. Receives include current receipts.',
      condition: {
        field: 'operation',
        value: ['oci_queue_put_messages', 'oci_queue_get_messages'],
      },
    },
    updatedMessage: {
      type: 'json',
      description: 'Message ID and new visibility timestamp.',
      condition: { field: 'operation', value: ['oci_queue_update_message'] },
    },
    entries: {
      type: 'array',
      description: 'Batch entries in request order, with index and success.',
      condition: {
        field: 'operation',
        value: ['oci_queue_delete_messages', 'oci_queue_update_messages'],
      },
    },
    clientFailures: {
      type: 'number',
      description: 'Client failure count.',
      condition: {
        field: 'operation',
        value: ['oci_queue_delete_messages', 'oci_queue_update_messages'],
      },
    },
    serverFailures: {
      type: 'number',
      description: 'Server failure count.',
      condition: {
        field: 'operation',
        value: ['oci_queue_delete_messages', 'oci_queue_update_messages'],
      },
    },
    allSucceeded: {
      type: 'boolean',
      description: 'True when both batch failure counts are zero.',
      condition: {
        field: 'operation',
        value: ['oci_queue_delete_messages', 'oci_queue_update_messages'],
      },
    },
    stats: {
      type: 'json',
      description: 'Queue and DLQ statistics.',
      condition: { field: 'operation', value: ['oci_queue_get_stats'] },
    },
    channels: {
      type: 'array',
      description: 'Approximate nonempty channel IDs.',
      condition: { field: 'operation', value: ['oci_queue_list_channels'] },
    },
    workRequests: {
      type: 'array',
      description: 'One page of work requests.',
      condition: { field: 'operation', value: ['oci_queue_list_work_requests'] },
    },
    workRequest: {
      type: 'json',
      description: 'Work request status, timestamps, and resources.',
      condition: { field: 'operation', value: ['oci_queue_get_work_request'] },
    },
    retryAfter: {
      type: 'number',
      description: 'Suggested seconds before another status check.',
      condition: { field: 'operation', value: ['oci_queue_get_work_request'] },
    },
    errors: {
      type: 'array',
      description: 'Work request errors.',
      condition: { field: 'operation', value: ['oci_queue_list_work_request_errors'] },
    },
    logs: {
      type: 'array',
      description: 'Work request logs.',
      condition: { field: 'operation', value: ['oci_queue_list_work_request_logs'] },
    },
  },
}

export const OciQueueBlockMeta = {
  tags: ['automation', 'monitoring'],
  url: 'https://www.oracle.com/cloud/queue/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Process queued jobs on a schedule',
      prompt:
        'Build a scheduled workflow that receives at most 10 OCI Queue messages with a 10-second poll, processes each message idempotently, and acknowledges only successful items using their exact current receipts. Route failures separately and leave all automatic block retries disabled.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Publish incoming webhook events',
      prompt:
        'Build a webhook workflow that validates events and sends one batch of at most 20 OCI Queue messages, respecting 256 KiB UTF-8 content and 512 KiB serialized batch limits. Record returned string message IDs without assuming input correlation. Leave automatic block retries disabled.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Monitor queue backlog and DLQ growth',
      prompt:
        'Build a scheduled workflow that reads OCI Queue statistics, compares visible and in-flight counts with thresholds, and sends a notification when the queue or DLQ grows. Do not consume or purge messages. Leave automatic block retries disabled.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Provision a queue and track completion',
      prompt:
        'Create a workflow that creates an OCI queue with the requested retention, visibility, and dead-letter threshold, then checks its work request in bounded scheduled steps until terminal status and reports any work request errors. Leave automatic block retries disabled.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Renew or release a received message',
      prompt:
        'Build a workflow that uses a current OCI Queue receipt to set visibility from now while processing, or sets it to zero to release the message. Respect retention and never substitute its message ID. Leave automatic block retries disabled.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Inspect partial acknowledgement results',
      prompt:
        'Build a workflow that acknowledges up to 20 successfully processed OCI Queue receipts, branches on allSucceeded, and records failed indices and provider error codes for deliberate follow-up. Do not replay successful entries. Leave automatic block retries disabled.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Review channels and purge approved backlog',
      prompt:
        'Build a workflow that lists nonempty channels and their statistics, waits for explicit operator approval to purge the chosen NORMAL, DLQ, or BOTH scope, and tracks the returned work request. Leave automatic block retries disabled.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation'],
    },
  ],
  skills: [
    {
      name: 'receive-process-acknowledge',
      description: 'Process a bounded receive batch using current receipts.',
      content:
        '# Receive, Process, and Acknowledge\n\n## Steps\n\n1. Use an OCI API-key credential with access to the queue and GetQueue discovery.\n2. Receive one batch with explicit limit and timeout; do not enable automatic block retries. Receiving changes state even with zero visibility.\n3. Process messages idempotently. Preserve IDs as strings and receipts exactly.\n4. Acknowledge successful messages with the current receipt, before another delivery invalidates it.\n\n## Output\n\nReport processed IDs and acknowledgement results, including failures.\n\nSource: https://docs.oracle.com/en-us/iaas/api/#/en/queue/20210201/Message/GetMessages',
    },
    {
      name: 'publish-queue-messages',
      description: 'Publish documented bounded batches without assumed correlation.',
      content:
        '# Publish Queue Messages\n\n## Steps\n\n1. Prepare 1–20 content strings, optionally with channel metadata.\n2. Keep each UTF-8 content within 256 KiB and the entire serialized request within 512 KiB.\n3. Publish once with automatic retries disabled.\n4. Preserve provider result order and decimal-string IDs. Oracle does not document atomicity or positional request/result correlation.\n\n## Output\n\nReturn published message results in provider order.\n\nSource: https://docs.oracle.com/en-us/iaas/api/#/en/queue/20210201/Message/PutMessages',
    },
    {
      name: 'inspect-queue-batch-outcomes',
      description: 'Handle acknowledgement and visibility partial failures.',
      content:
        '# Inspect Batch Outcomes\n\n## Steps\n\n1. Send at most 20 entries using current receipts.\n2. Match returned indices to input order.\n3. Inspect allSucceeded, clientFailures, serverFailures, and each entry. A valid partial response is a successful transport result.\n4. Decide follow-up per failed entry; do not automatically replay the whole batch.\n\n## Output\n\nReport success indices and failure details separately.\n\nSource: https://docs.oracle.com/en-us/iaas/api/#/en/queue/20210201/Message/DeleteMessages',
    },
    {
      name: 'track-queue-management',
      description: 'Track asynchronous queue changes through work requests.',
      content:
        '# Track Queue Management\n\n## Steps\n\n1. Submit the requested create, update, delete, move, or purge operation.\n2. Treat 202 as acceptance and retain workRequestId.\n3. Check Get Work Request with bounded scheduled invocations, respecting retryAfter when returned.\n4. Inspect paginated logs and errors for failed requests. Do not invent completion or queue details from an empty 202.\n\n## Output\n\nReturn the accepted work request and its observed status.\n\nSource: https://docs.oracle.com/en-us/iaas/api/#/en/queue/20210201/WorkRequest/GetWorkRequest',
    },
    {
      name: 'manage-queue-visibility',
      description: 'Set visibility relative to now or release a received message.',
      content:
        '# Manage Visibility\n\n## Steps\n\n1. Use the exact current receipt.\n2. Set visibility to 0–43200 seconds from the time Oracle processes the request. Zero makes the message available; retention still bounds its lifetime.\n3. Do not assume a new receipt is returned or extend an old visibility deadline arithmetically.\n4. Keep automatic retries disabled.\n\n## Output\n\nReturn the decimal-string message ID and visibleAfter timestamp, or per-entry outcomes for a batch.\n\nSource: https://docs.oracle.com/en-us/iaas/api/#/en/queue/20210201/Message/UpdateMessage',
    },
    {
      name: 'inspect-and-purge-queue',
      description: 'Inspect channels and explicitly purge documented queue scopes.',
      content:
        '# Inspect and Purge Queue\n\n## Steps\n\n1. List one page of nonempty channels and inspect queue/DLQ statistics. Channel enumeration is approximate.\n2. Use literal channel IDs; do not assume wildcard filter syntax.\n3. Purge only an explicitly requested NORMAL, DLQ, or BOTH scope, with optional channel IDs and an existing consumer group.\n4. Track the work request; do not automatically retry purge. DLQ consumption and redrive are outside this integration.\n\n## Output\n\nReturn statistics or the purge work request ID.\n\nSource: https://docs.oracle.com/en-us/iaas/api/#/en/queue/20210201/Queue/PurgeQueue',
    },
  ],
} satisfies BlockMeta
