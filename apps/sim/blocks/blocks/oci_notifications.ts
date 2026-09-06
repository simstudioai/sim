import { NetSuiteIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { parseOptionalNumberInput } from '@/blocks/utils'
import type { OciNotificationsResponse } from '@/tools/oci_notifications/types'

const OPERATION_FIELDS: Readonly<Record<string, readonly string[]>> = {
  oci_notifications_list_topics: [
    'compartmentId',
    'id',
    'name',
    'lifecycleState',
    'sortBy',
    'sortOrder',
    'limit',
    'page',
  ],
  oci_notifications_get_topic: ['topicId'],
  oci_notifications_create_topic: [
    'compartmentId',
    'name',
    'description',
    'freeformTags',
    'definedTags',
    'retryToken',
  ],
  oci_notifications_update_topic: [
    'topicId',
    'description',
    'freeformTags',
    'definedTags',
    'ifMatch',
    'isLockOverride',
  ],
  oci_notifications_delete_topic: ['topicId', 'ifMatch', 'isLockOverride'],
  oci_notifications_change_topic_compartment: [
    'topicId',
    'destinationCompartmentId',
    'ifMatch',
    'retryToken',
    'isLockOverride',
  ],
  oci_notifications_add_topic_lock: ['topicId', 'lock', 'ifMatch'],
  oci_notifications_remove_topic_lock: ['topicId', 'lock', 'ifMatch'],
  oci_notifications_list_subscriptions: ['topicId', 'compartmentId', 'limit', 'page'],
  oci_notifications_get_subscription: ['topicId', 'subscriptionId'],
  oci_notifications_create_subscription: [
    'topicId',
    'protocol',
    'endpoint',
    'metadata',
    'freeformTags',
    'definedTags',
    'retryToken',
  ],
  oci_notifications_update_subscription: [
    'topicId',
    'subscriptionId',
    'deliveryPolicy',
    'freeformTags',
    'definedTags',
    'ifMatch',
  ],
  oci_notifications_delete_subscription: ['topicId', 'subscriptionId', 'ifMatch'],
  oci_notifications_change_subscription_compartment: [
    'topicId',
    'subscriptionId',
    'destinationCompartmentId',
    'ifMatch',
    'retryToken',
  ],
  oci_notifications_resend_subscription_confirmation: ['topicId', 'subscriptionId'],
  oci_notifications_publish_message: ['topicId', 'body', 'title'],
}

const JSON_FIELDS = new Set(['freeformTags', 'definedTags', 'lock', 'deliveryPolicy'])

function parseJson(value: unknown, label: string): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`${label} must be valid JSON`)
  }
}

export const OciNotificationsBlock: BlockConfig<OciNotificationsResponse> = {
  type: 'oci_notifications',
  name: 'OCI Notifications',
  description: 'Publish messages and manage notification topics and subscriptions',
  longDescription:
    'Connect an OCI API-key service account to publish messages and manage topics, subscriptions, tags, compartments, and locks. Subscription and publish operations discover the topic endpoint using GetTopic and require ONS_TOPIC_READ in addition to their operation permissions. Use the recipient confirmation flow; pending subscriptions do not receive messages and Functions need no confirmation. Direct publication does not deliver SMS. Publish runs once, and acceptance is not delivery. Leave whole-block retries disabled because an ambiguous failure can still have published. Sim conservatively caps serialized publish requests at 64,000 UTF-8 bytes. No inbound trigger is provided.',
  docsLink: 'https://docs.sim.ai/integrations/oci_notifications',
  authMode: AuthMode.ApiKey,
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  bgColor: '#FFFFFF',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'OCI Notifications',
    sentences: {
      byOperation: {
        oci_notifications_list_topics: ['List topics'],
        oci_notifications_get_topic: ['Get topic'],
        oci_notifications_create_topic: ['Create topic'],
        oci_notifications_update_topic: ['Update topic'],
        oci_notifications_delete_topic: ['Delete topic'],
        oci_notifications_change_topic_compartment: ['Change topic compartment'],
        oci_notifications_add_topic_lock: ['Add topic lock'],
        oci_notifications_remove_topic_lock: ['Remove topic lock'],
        oci_notifications_list_subscriptions: ['List subscriptions'],
        oci_notifications_get_subscription: ['Get subscription'],
        oci_notifications_create_subscription: ['Create subscription'],
        oci_notifications_update_subscription: ['Update subscription'],
        oci_notifications_delete_subscription: ['Delete subscription'],
        oci_notifications_change_subscription_compartment: ['Change subscription compartment'],
        oci_notifications_resend_subscription_confirmation: ['Resend subscription confirmation'],
        oci_notifications_publish_message: ['Publish message'],
      },
    },
  },
  subBlocks: [
    {
      id: 'credential',
      title: 'OCI Account',
      type: 'oauth-input',
      serviceId: 'oci-notifications',
      credentialKind: 'service-account',
      requiredScopes: getScopesForService('oci-notifications'),
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
      required: true,
    },
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Topics', id: 'oci_notifications_list_topics' },
        { label: 'Get Topic', id: 'oci_notifications_get_topic' },
        { label: 'Create Topic', id: 'oci_notifications_create_topic' },
        { label: 'Update Topic', id: 'oci_notifications_update_topic' },
        { label: 'Delete Topic', id: 'oci_notifications_delete_topic' },
        { label: 'Change Topic Compartment', id: 'oci_notifications_change_topic_compartment' },
        { label: 'Add Topic Lock', id: 'oci_notifications_add_topic_lock' },
        { label: 'Remove Topic Lock', id: 'oci_notifications_remove_topic_lock' },
        { label: 'List Subscriptions', id: 'oci_notifications_list_subscriptions' },
        { label: 'Get Subscription', id: 'oci_notifications_get_subscription' },
        { label: 'Create Subscription', id: 'oci_notifications_create_subscription' },
        { label: 'Update Subscription', id: 'oci_notifications_update_subscription' },
        { label: 'Delete Subscription', id: 'oci_notifications_delete_subscription' },
        {
          label: 'Change Subscription Compartment',
          id: 'oci_notifications_change_subscription_compartment',
        },
        {
          label: 'Resend Subscription Confirmation',
          id: 'oci_notifications_resend_subscription_confirmation',
        },
        { label: 'Publish Message', id: 'oci_notifications_publish_message' },
      ],
      value: () => 'oci_notifications_list_topics',
      required: true,
    },
    {
      id: 'region',
      title: 'Region',
      type: 'short-input',
      placeholder: 'Defaults to the saved credential region',
    },
    {
      id: 'topicCompartmentId',
      title: 'Topic Compartment',
      type: 'short-input',
      placeholder: 'Required to browse topics; not needed with a manual Topic ID.',
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'oci_notifications_get_topic',
          'oci_notifications_update_topic',
          'oci_notifications_delete_topic',
          'oci_notifications_change_topic_compartment',
          'oci_notifications_add_topic_lock',
          'oci_notifications_remove_topic_lock',
          'oci_notifications_list_subscriptions',
          'oci_notifications_get_subscription',
          'oci_notifications_create_subscription',
          'oci_notifications_update_subscription',
          'oci_notifications_delete_subscription',
          'oci_notifications_change_subscription_compartment',
          'oci_notifications_resend_subscription_confirmation',
          'oci_notifications_publish_message',
        ],
      },
    },
    {
      id: 'topicSelector',
      title: 'Topic',
      type: 'project-selector',
      canonicalParamId: 'topicId',
      serviceId: 'oci-notifications',
      selectorKey: 'oci_notifications.topics',
      dependsOn: ['credential', 'topicCompartmentId', 'region'],
      mode: 'basic',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'oci_notifications_get_topic',
          'oci_notifications_update_topic',
          'oci_notifications_delete_topic',
          'oci_notifications_change_topic_compartment',
          'oci_notifications_add_topic_lock',
          'oci_notifications_remove_topic_lock',
          'oci_notifications_list_subscriptions',
          'oci_notifications_get_subscription',
          'oci_notifications_create_subscription',
          'oci_notifications_update_subscription',
          'oci_notifications_delete_subscription',
          'oci_notifications_change_subscription_compartment',
          'oci_notifications_resend_subscription_confirmation',
          'oci_notifications_publish_message',
        ],
      },
    },
    {
      id: 'manualTopicId',
      title: 'Topic',
      type: 'short-input',
      canonicalParamId: 'topicId',
      mode: 'advanced',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'oci_notifications_get_topic',
          'oci_notifications_update_topic',
          'oci_notifications_delete_topic',
          'oci_notifications_change_topic_compartment',
          'oci_notifications_add_topic_lock',
          'oci_notifications_remove_topic_lock',
          'oci_notifications_list_subscriptions',
          'oci_notifications_get_subscription',
          'oci_notifications_create_subscription',
          'oci_notifications_update_subscription',
          'oci_notifications_delete_subscription',
          'oci_notifications_change_subscription_compartment',
          'oci_notifications_resend_subscription_confirmation',
          'oci_notifications_publish_message',
        ],
      },
    },
    {
      id: 'subscriptionSelector',
      title: 'Subscription',
      type: 'project-selector',
      canonicalParamId: 'subscriptionId',
      serviceId: 'oci-notifications',
      selectorKey: 'oci_notifications.subscriptions',
      dependsOn: ['credential', 'topicSelector', 'compartmentId', 'region'],
      mode: 'basic',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'oci_notifications_get_subscription',
          'oci_notifications_update_subscription',
          'oci_notifications_delete_subscription',
          'oci_notifications_change_subscription_compartment',
          'oci_notifications_resend_subscription_confirmation',
        ],
      },
    },
    {
      id: 'manualSubscriptionId',
      title: 'Subscription',
      type: 'short-input',
      canonicalParamId: 'subscriptionId',
      mode: 'advanced',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'oci_notifications_get_subscription',
          'oci_notifications_update_subscription',
          'oci_notifications_delete_subscription',
          'oci_notifications_change_subscription_compartment',
          'oci_notifications_resend_subscription_confirmation',
        ],
      },
    },
    {
      id: 'compartmentId',
      title: 'Compartment ID',
      type: 'short-input',
      placeholder:
        'Required for topic creation and lists, or to browse subscriptions. Use the subscription compartment, which may differ from the topic.',
      condition: {
        field: 'operation',
        value: [
          'oci_notifications_list_topics',
          'oci_notifications_create_topic',
          'oci_notifications_list_subscriptions',
          'oci_notifications_get_subscription',
          'oci_notifications_update_subscription',
          'oci_notifications_delete_subscription',
          'oci_notifications_change_subscription_compartment',
          'oci_notifications_resend_subscription_confirmation',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oci_notifications_list_topics',
          'oci_notifications_create_topic',
          'oci_notifications_list_subscriptions',
        ],
      },
    },
    {
      id: 'id',
      title: 'Id',
      type: 'short-input',
      placeholder: 'Optional exact topic OCID filter.',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oci_notifications_list_topics'],
      },
    },
    {
      id: 'name',
      title: 'Topic Name',
      type: 'short-input',
      placeholder:
        'Topic name, unique across the tenancy when creating (maximum 256 characters). List filtering is exact.',
      condition: {
        field: 'operation',
        value: ['oci_notifications_list_topics', 'oci_notifications_create_topic'],
      },
      required: {
        field: 'operation',
        value: ['oci_notifications_create_topic'],
      },
    },
    {
      id: 'lifecycleState',
      title: 'Lifecycle State',
      type: 'dropdown',
      placeholder: 'Filter topics by ACTIVE, CREATING, or DELETING.',
      mode: 'advanced',
      options: [
        { label: 'ACTIVE', id: 'ACTIVE' },
        { label: 'CREATING', id: 'CREATING' },
        { label: 'DELETING', id: 'DELETING' },
      ],
      condition: {
        field: 'operation',
        value: ['oci_notifications_list_topics'],
      },
    },
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'dropdown',
      placeholder: 'TIMECREATED (default) or LIFECYCLESTATE.',
      mode: 'advanced',
      options: [
        { label: 'TIMECREATED', id: 'TIMECREATED' },
        { label: 'LIFECYCLESTATE', id: 'LIFECYCLESTATE' },
      ],
      condition: {
        field: 'operation',
        value: ['oci_notifications_list_topics'],
      },
    },
    {
      id: 'sortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      placeholder: 'ASC or DESC. Time-created sorting defaults to DESC.',
      mode: 'advanced',
      options: [
        { label: 'ASC', id: 'ASC' },
        { label: 'DESC', id: 'DESC' },
      ],
      condition: {
        field: 'operation',
        value: ['oci_notifications_list_topics'],
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Maximum results in this page: 1–50; Oracle defaults to 10.',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oci_notifications_list_topics', 'oci_notifications_list_subscriptions'],
      },
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: 'Opaque nextPage token from the preceding list response.',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oci_notifications_list_topics', 'oci_notifications_list_subscriptions'],
      },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder:
        'Topic description, at most 256 characters. Required for Update Topic; an empty string clears it.',
      condition: {
        field: 'operation',
        value: ['oci_notifications_create_topic', 'oci_notifications_update_topic'],
      },
      /** Empty text clears the description; key presence is validated by the server. */
      required: false,
    },
    {
      id: 'freeformTags',
      title: 'Freeform Tags',
      type: 'long-input',
      placeholder:
        'Object mapping freeform tag names to string values. Example: {"Department":"Operations"}.',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Object mapping freeform tag names to string values. Example: {"Department":"Operations"}. Use only supplied identifiers. Return ONLY valid JSON.',
      },
      condition: {
        field: 'operation',
        value: [
          'oci_notifications_create_topic',
          'oci_notifications_update_topic',
          'oci_notifications_create_subscription',
          'oci_notifications_update_subscription',
        ],
      },
    },
    {
      id: 'definedTags',
      title: 'Defined Tags',
      type: 'long-input',
      placeholder: 'Namespaced string tags. Example: {"Operations":{"CostCenter":"42"}}.',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Namespaced string tags. Example: {"Operations":{"CostCenter":"42"}}. Use only supplied identifiers. Return ONLY valid JSON.',
      },
      condition: {
        field: 'operation',
        value: [
          'oci_notifications_create_topic',
          'oci_notifications_update_topic',
          'oci_notifications_create_subscription',
          'oci_notifications_update_subscription',
        ],
      },
    },
    {
      id: 'retryToken',
      title: 'Retry Token',
      type: 'short-input',
      placeholder:
        'Optional Oracle retry token (1–64 characters). Enables at most two tokenized attempts; expires after 24 hours or a conflict.',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oci_notifications_create_topic',
          'oci_notifications_change_topic_compartment',
          'oci_notifications_create_subscription',
          'oci_notifications_change_subscription_compartment',
        ],
      },
    },
    {
      id: 'ifMatch',
      title: 'If Match',
      type: 'short-input',
      placeholder: 'Optional ETag for optimistic concurrency.',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oci_notifications_update_topic',
          'oci_notifications_delete_topic',
          'oci_notifications_change_topic_compartment',
          'oci_notifications_add_topic_lock',
          'oci_notifications_remove_topic_lock',
          'oci_notifications_update_subscription',
          'oci_notifications_delete_subscription',
          'oci_notifications_change_subscription_compartment',
        ],
      },
    },
    {
      id: 'isLockOverride',
      title: 'Is Lock Override',
      type: 'switch',
      placeholder:
        'Override topic locks for this operation, with appropriate lock permissions. Defaults to false.',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oci_notifications_update_topic',
          'oci_notifications_delete_topic',
          'oci_notifications_change_topic_compartment',
        ],
      },
    },
    {
      id: 'destinationCompartmentId',
      title: 'Destination Compartment Id',
      type: 'short-input',
      placeholder:
        'Destination compartment OCID in the same tenancy. Moving a topic does not move its subscriptions.',
      condition: {
        field: 'operation',
        value: [
          'oci_notifications_change_topic_compartment',
          'oci_notifications_change_subscription_compartment',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oci_notifications_change_topic_compartment',
          'oci_notifications_change_subscription_compartment',
        ],
      },
    },
    {
      id: 'lock',
      title: 'Lock Details',
      type: 'long-input',
      placeholder:
        'Lock object: required type (FULL or DELETE) and compartmentId; optional message, relatedResourceId, timeCreated (RFC3339).',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Lock object: required type (FULL or DELETE) and compartmentId; optional message, relatedResourceId, timeCreated (RFC3339). Use only supplied identifiers. Return ONLY valid JSON.',
      },
      condition: {
        field: 'operation',
        value: ['oci_notifications_add_topic_lock', 'oci_notifications_remove_topic_lock'],
      },
      required: {
        field: 'operation',
        value: ['oci_notifications_add_topic_lock', 'oci_notifications_remove_topic_lock'],
      },
    },
    {
      id: 'protocol',
      title: 'Protocol',
      type: 'dropdown',
      placeholder:
        'EMAIL, CUSTOM_HTTPS, ORACLE_FUNCTIONS, PAGERDUTY, SLACK, or SMS. Direct publishing does not deliver SMS.',
      options: [
        { label: 'EMAIL', id: 'EMAIL' },
        { label: 'CUSTOM_HTTPS', id: 'CUSTOM_HTTPS' },
        { label: 'ORACLE_FUNCTIONS', id: 'ORACLE_FUNCTIONS' },
        { label: 'PAGERDUTY', id: 'PAGERDUTY' },
        { label: 'SLACK', id: 'SLACK' },
        { label: 'SMS', id: 'SMS' },
      ],
      value: () => 'EMAIL',
      condition: {
        field: 'operation',
        value: ['oci_notifications_create_subscription'],
      },
      required: {
        field: 'operation',
        value: ['oci_notifications_create_subscription'],
      },
    },
    {
      id: 'endpoint',
      title: 'Delivery Endpoint',
      type: 'short-input',
      placeholder:
        'Delivery endpoint (maximum 512 characters): email, public HTTPS URL, function OCID, PagerDuty/Slack webhook, or E.164 phone. HTTPS permits Basic authentication but no query parameters or custom headers.',
      password: true,
      condition: {
        field: 'operation',
        value: ['oci_notifications_create_subscription'],
      },
      required: {
        field: 'operation',
        value: ['oci_notifications_create_subscription'],
      },
    },
    {
      id: 'metadata',
      title: 'Metadata',
      type: 'long-input',
      placeholder: 'Optional subscription metadata string, at most 1024 characters.',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oci_notifications_create_subscription'],
      },
    },
    {
      id: 'deliveryPolicy',
      title: 'Delivery Policy',
      type: 'long-input',
      placeholder:
        'Delivery retry object: {"backoffRetryPolicy":{"policyType":"EXPONENTIAL","maxRetryDuration":7200000}}. Duration is 60000–7200000 milliseconds.',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Delivery retry object: {"backoffRetryPolicy":{"policyType":"EXPONENTIAL","maxRetryDuration":7200000}}. Duration is 60000–7200000 milliseconds. Use only supplied identifiers. Return ONLY valid JSON.',
      },
      condition: {
        field: 'operation',
        value: ['oci_notifications_update_subscription'],
      },
    },
    {
      id: 'body',
      title: 'Message',
      type: 'long-input',
      placeholder:
        'Message text. Sim caps the entire serialized request at 64,000 UTF-8 bytes. Publish runs once; keep block retries disabled to avoid duplicates.',
      condition: {
        field: 'operation',
        value: ['oci_notifications_publish_message'],
      },
      required: {
        field: 'operation',
        value: ['oci_notifications_publish_message'],
      },
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder:
        'Optional title, at most 255 characters. Used by email and PagerDuty; ignored by HTTPS, Slack, and SMS.',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oci_notifications_publish_message'],
      },
    },
  ],
  tools: {
    access: [
      'oci_notifications_list_topics',
      'oci_notifications_get_topic',
      'oci_notifications_create_topic',
      'oci_notifications_update_topic',
      'oci_notifications_delete_topic',
      'oci_notifications_change_topic_compartment',
      'oci_notifications_add_topic_lock',
      'oci_notifications_remove_topic_lock',
      'oci_notifications_list_subscriptions',
      'oci_notifications_get_subscription',
      'oci_notifications_create_subscription',
      'oci_notifications_update_subscription',
      'oci_notifications_delete_subscription',
      'oci_notifications_change_subscription_compartment',
      'oci_notifications_resend_subscription_confirmation',
      'oci_notifications_publish_message',
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
          const value = params[field]
          const clearDescription =
            field === 'description' && params.operation === 'oci_notifications_update_topic'
          if (value === null || value === undefined || (value === '' && !clearDescription)) {
            result[field] = undefined
          } else if (JSON_FIELDS.has(field)) {
            result[field] = parseJson(value, field)
          } else if (field === 'limit') {
            result[field] = parseOptionalNumberInput(value, field, { integer: true })
          } else if (field === 'isLockOverride') {
            result[field] = value === true || value === 'true'
          } else {
            result[field] = value
          }
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'OCI Notifications operation.' },
    topicCompartmentId: {
      type: 'string',
      description: 'Compartment used to browse parent topics.',
    },
    oauthCredential: {
      type: 'string',
      description: 'OCI API-key service account credential ID.',
    },
    region: {
      type: 'string',
      description: 'Optional OCI region; defaults to the saved credential region.',
    },
    compartmentId: {
      type: 'string',
      description:
        'Compartment OCID. For subscriptions, use their current compartment, which may differ from the topic.',
    },
    topicId: {
      type: 'string',
      description:
        'Topic OCID. Subscription and publish endpoints are discovered with GetTopic; ONS_TOPIC_READ is required.',
    },
    subscriptionId: {
      type: 'string',
      description: 'Subscription OCID. The topic selects its routing endpoint.',
    },
    name: {
      type: 'string',
      description:
        'Topic name, unique across the tenancy when creating (maximum 256 characters). List filtering is exact.',
    },
    id: {
      type: 'string',
      description: 'Optional exact topic OCID filter.',
    },
    description: {
      type: 'string',
      description:
        'Topic description, at most 256 characters. Required for Update Topic; an empty string clears it.',
    },
    lifecycleState: {
      type: 'string',
      description: 'Filter topics by ACTIVE, CREATING, or DELETING.',
    },
    sortBy: {
      type: 'string',
      description: 'TIMECREATED (default) or LIFECYCLESTATE.',
    },
    sortOrder: {
      type: 'string',
      description: 'ASC or DESC. Time-created sorting defaults to DESC.',
    },
    limit: {
      type: 'number',
      description: 'Maximum results in this page: 1–50; Oracle defaults to 10.',
    },
    page: {
      type: 'string',
      description: 'Opaque nextPage token from the preceding list response.',
    },
    freeformTags: {
      type: 'json',
      description:
        'Object mapping freeform tag names to string values. Example: {"Department":"Operations"}.',
    },
    definedTags: {
      type: 'json',
      description: 'Namespaced string tags. Example: {"Operations":{"CostCenter":"42"}}.',
    },
    ifMatch: {
      type: 'string',
      description: 'Optional ETag for optimistic concurrency.',
    },
    retryToken: {
      type: 'string',
      description:
        'Optional Oracle retry token (1–64 characters). Enables at most two tokenized attempts; expires after 24 hours or a conflict.',
    },
    isLockOverride: {
      type: 'boolean',
      description:
        'Override topic locks for this operation, with appropriate lock permissions. Defaults to false.',
    },
    destinationCompartmentId: {
      type: 'string',
      description:
        'Destination compartment OCID in the same tenancy. Moving a topic does not move its subscriptions.',
    },
    lock: {
      type: 'json',
      description:
        'Lock object: required type (FULL or DELETE) and compartmentId; optional message, relatedResourceId, timeCreated (RFC3339).',
    },
    protocol: {
      type: 'string',
      description:
        'EMAIL, CUSTOM_HTTPS, ORACLE_FUNCTIONS, PAGERDUTY, SLACK, or SMS. Direct publishing does not deliver SMS.',
    },
    endpoint: {
      type: 'string',
      description:
        'Delivery endpoint (maximum 512 characters): email, public HTTPS URL, function OCID, PagerDuty/Slack webhook, or E.164 phone. HTTPS permits Basic authentication but no query parameters or custom headers.',
    },
    metadata: {
      type: 'string',
      description: 'Optional subscription metadata string, at most 1024 characters.',
    },
    deliveryPolicy: {
      type: 'json',
      description:
        'Delivery retry object: {"backoffRetryPolicy":{"policyType":"EXPONENTIAL","maxRetryDuration":7200000}}. Duration is 60000–7200000 milliseconds.',
    },
    body: {
      type: 'string',
      description:
        'Message text. Sim caps the entire serialized request at 64,000 UTF-8 bytes. Publish runs once; keep block retries disabled to avoid duplicates.',
    },
    title: {
      type: 'string',
      description:
        'Optional title, at most 255 characters. Used by email and PagerDuty; ignored by HTTPS, Slack, and SMS.',
    },
  },
  outputs: {
    status: { type: 'number', description: 'HTTP status from Oracle.' },
    requestId: { type: 'string', description: 'Oracle request ID.' },
    etag: { type: 'string', description: 'ETag for conditional management requests.' },
    nextPage: { type: 'string', description: 'Opaque token for another list page.' },
    topic: {
      type: 'json',
      description: 'Topic configuration including IDs, lifecycle, tags, and locks.',
    },
    topics: { type: 'array', description: 'One page of topic configurations.' },
    subscription: {
      type: 'json',
      description: 'Subscription IDs, protocol, endpoint, lifecycle, policy, and tags.',
    },
    subscriptions: { type: 'array', description: 'One page of subscriptions.' },
    subscriptionUpdate: {
      type: 'json',
      description: 'Updated subscription deliveryPolicy, freeformTags, and definedTags.',
    },
    messageId: { type: 'string', description: 'Accepted message ID; not proof of delivery.' },
    timeStamp: { type: 'string', description: 'RFC3339 service-received timestamp.' },
  },
}

export const OciNotificationsBlockMeta = {
  tags: ['automation', 'monitoring'],
  url: 'https://www.oracle.com/cloud/notifications/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Publish an operations notification',
      prompt:
        'Publish a short operations message to an existing OCI Notifications topic. Keep block retries disabled, record the returned message ID, and do not assume acceptance proves subscriber delivery.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Create an email notification channel',
      prompt:
        'Create an OCI Notifications topic and an EMAIL subscription for the supplied address. Explain recipient confirmation and inspect its state before publishing.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Connect a function to a topic',
      prompt:
        'Create an ORACLE_FUNCTIONS subscription for the supplied OCI function OCID, then publish a bounded message. Require function invocation permission; Functions need no confirmation.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Review pending subscriptions',
      prompt:
        'List one page of subscriptions in the supplied topic and subscription compartment. Inspect pending subscriptions and resend confirmation only when requested.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Tune subscription retry duration',
      prompt:
        'Update the supplied OCI Notifications subscription with an EXPONENTIAL delivery policy and a maximum retry duration between 60000 and 7200000 milliseconds. Preserve unrelated tags.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Organize notification resources',
      prompt:
        'List topics in the supplied compartment and update requested descriptions and tags. Move only explicitly selected resources; moving a topic does not move its subscriptions.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Protect a notification topic',
      prompt:
        'Add a FULL or DELETE lock to the selected OCI Notifications topic using the supplied lock compartment and message. Inspect the returned locks and require the documented lock permissions.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation'],
    },
  ],
  skills: [
    {
      name: 'publish-notifications',
      description: 'Publish a bounded message to active topic subscriptions.',
      content:
        '# Publish Notifications\n\n## Steps\n\n1. Select an OCI credential and topic.\n2. Publish one message within the 64,000-byte serialized limit with block retries disabled.\n3. Record messageId and timeStamp when returned. Acceptance is not delivery; direct SMS is unsupported.\n\n## Output\n\nReport acceptance or ambiguous failure; do not automatically resend.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/Notification/Tasks/publishingmessages.htm',
    },
    {
      name: 'manage-topic-subscriptions',
      description: 'Create and inspect recipient subscriptions.',
      content:
        '# Manage Topic Subscriptions\n\n## Steps\n\n1. Select a parent topic and protocol.\n2. Create a subscription in its parent compartment.\n3. Have the recipient confirm through Oracle; Functions need no confirmation.\n4. Inspect the subscription lifecycle before expecting delivery.\n\n## Output\n\nReturn subscription ID and lifecycle state, not an invented confirmation URL.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/Notification/Tasks/create-subscription.htm',
    },
    {
      name: 'review-pending-confirmations',
      description: 'Inspect pending subscriptions and resend confirmation.',
      content:
        '# Review Pending Confirmations\n\n## Steps\n\n1. List one page of subscriptions with the topic and current subscription compartment.\n2. Inspect pending entries.\n3. Resend confirmation only when requested; links last three days.\n\n## Output\n\nReturn the observed state; do not follow recipient URLs.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/Notification/Tasks/confirm-subscription.htm',
    },
    {
      name: 'configure-delivery-retries',
      description: 'Set the subscription delivery retry duration.',
      content:
        '# Configure Delivery Retries\n\n## Steps\n\n1. Get the subscription and ETag.\n2. Update deliveryPolicy.backoffRetryPolicy with EXPONENTIAL and 60000–7200000 milliseconds.\n3. Keep subscription delivery retries distinct from workflow block retries.\n\n## Output\n\nReturn the updated policy and ETag when supplied.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/Notification/Tasks/update-subscription.htm',
    },
    {
      name: 'move-notification-resources',
      description: 'Move topics or subscriptions between authorized compartments.',
      content:
        '# Move Notification Resources\n\n## Steps\n\n1. Inspect the selected resource.\n2. Choose a destination in the same tenancy.\n3. Move the requested topic or subscription using its ETag if available.\n4. Topic and subscription compartments move independently.\n\n## Output\n\nReport HTTP status and Oracle request ID.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/Notification/Tasks/change-compartment-topic.htm',
    },
    {
      name: 'protect-notification-topics',
      description: 'Manage FULL and DELETE topic locks.',
      content:
        '# Protect Notification Topics\n\n## Steps\n\n1. Get the topic and its locks.\n2. Supply the documented lock object and required resource-lock permissions.\n3. Add or remove only the requested lock.\n\n## Output\n\nReturn the topic and its resulting locks.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/Notification/Tasks/add-topic-lock.htm',
    },
  ],
} satisfies BlockMeta
