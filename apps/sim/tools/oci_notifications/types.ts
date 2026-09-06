import type { ToolResponse } from '@/tools/types'

export interface OciNotificationsAuthParams {
  oauthCredential: string
  region?: string
}

export interface OciNotificationsTopicParams extends OciNotificationsAuthParams {
  topicId: string
}

export interface OciNotificationsSubscriptionParams extends OciNotificationsTopicParams {
  subscriptionId: string
}

export interface OciNotificationsTags {
  freeformTags?: Record<string, string>
  definedTags?: Record<string, Record<string, string>>
}

export interface OciNotificationsPageParams {
  limit?: number
  page?: string
}

export interface OciNotificationsListTopicsParams
  extends OciNotificationsAuthParams,
    OciNotificationsPageParams {
  compartmentId: string
  id?: string
  name?: string
  lifecycleState?: 'ACTIVE' | 'DELETING' | 'CREATING'
  sortBy?: 'TIMECREATED' | 'LIFECYCLESTATE'
  sortOrder?: 'ASC' | 'DESC'
}

export interface OciNotificationsGetTopicParams extends OciNotificationsTopicParams {}

export interface OciNotificationsCreateTopicParams
  extends OciNotificationsAuthParams,
    OciNotificationsTags {
  compartmentId: string
  name: string
  description?: string
  retryToken?: string
}

export interface OciNotificationsUpdateTopicParams
  extends OciNotificationsTopicParams,
    OciNotificationsTags {
  description: string
  ifMatch?: string
  isLockOverride?: boolean
}

export interface OciNotificationsDeleteTopicParams extends OciNotificationsTopicParams {
  ifMatch?: string
  isLockOverride?: boolean
}

export interface OciNotificationsChangeTopicCompartmentParams
  extends OciNotificationsDeleteTopicParams {
  destinationCompartmentId: string
  retryToken?: string
}

export interface OciNotificationsLock {
  type: 'FULL' | 'DELETE'
  compartmentId: string
  message?: string
  relatedResourceId?: string
  timeCreated?: string
}

export interface OciNotificationsAddTopicLockParams extends OciNotificationsTopicParams {
  lock: OciNotificationsLock
  ifMatch?: string
}

export interface OciNotificationsRemoveTopicLockParams extends OciNotificationsAddTopicLockParams {}

export interface OciNotificationsListSubscriptionsParams
  extends OciNotificationsTopicParams,
    OciNotificationsPageParams {
  compartmentId: string
}

export interface OciNotificationsGetSubscriptionParams extends OciNotificationsSubscriptionParams {}

export interface OciNotificationsCreateSubscriptionParams
  extends OciNotificationsTopicParams,
    OciNotificationsTags {
  protocol: 'EMAIL' | 'CUSTOM_HTTPS' | 'ORACLE_FUNCTIONS' | 'PAGERDUTY' | 'SLACK' | 'SMS'
  endpoint: string
  metadata?: string
  retryToken?: string
}

export interface OciNotificationsDeliveryPolicy {
  backoffRetryPolicy?: {
    policyType: 'EXPONENTIAL'
    maxRetryDuration: number
  }
}

export interface OciNotificationsUpdateSubscriptionParams
  extends OciNotificationsSubscriptionParams,
    OciNotificationsTags {
  deliveryPolicy?: OciNotificationsDeliveryPolicy
  ifMatch?: string
}

export interface OciNotificationsDeleteSubscriptionParams
  extends OciNotificationsSubscriptionParams {
  ifMatch?: string
}

export interface OciNotificationsChangeSubscriptionCompartmentParams
  extends OciNotificationsDeleteSubscriptionParams {
  destinationCompartmentId: string
  retryToken?: string
}

export interface OciNotificationsResendSubscriptionConfirmationParams
  extends OciNotificationsSubscriptionParams {}

export interface OciNotificationsPublishMessageParams extends OciNotificationsTopicParams {
  body: string
  title?: string
}

export interface OciNotificationsTopic extends OciNotificationsTags {
  topicId: string
  name: string
  compartmentId: string
  lifecycleState: string
  timeCreated: string
  apiEndpoint: string
  description?: string
  etag?: string
  shortTopicId?: string
  locks?: OciNotificationsLock[]
  systemTags?: Record<string, Record<string, string>>
}

export interface OciNotificationsSubscriptionUpdate extends OciNotificationsTags {
  deliveryPolicy?: OciNotificationsDeliveryPolicy
}

export interface OciNotificationsSubscriptionSummary extends OciNotificationsSubscriptionUpdate {
  id: string
  topicId: string
  compartmentId: string
  protocol: string
  endpoint: string
  lifecycleState: string
  createdTime?: number
  etag?: string
}

export interface OciNotificationsSubscription extends OciNotificationsSubscriptionSummary {
  deliverPolicy?: string
}

export interface OciNotificationsOutput {
  status: number
  requestId?: string
  etag?: string
  nextPage?: string
  topic?: OciNotificationsTopic
  topics?: OciNotificationsTopic[]
  subscription?: OciNotificationsSubscription
  subscriptions?: OciNotificationsSubscriptionSummary[]
  subscriptionUpdate?: OciNotificationsSubscriptionUpdate
  messageId?: string
  timeStamp?: string
}

export interface OciNotificationsResponse extends ToolResponse {
  output: OciNotificationsOutput
}

export const OCI_NOTIFICATIONS_TAG_PROPERTIES = {
  freeformTags: { type: 'object', description: 'Freeform string tags.', optional: true },
  definedTags: { type: 'object', description: 'Namespaced string tags.', optional: true },
} as const

export const OCI_NOTIFICATIONS_DELIVERY_POLICY_PROPERTIES = {
  backoffRetryPolicy: {
    type: 'object',
    description: 'Exponential delivery retry policy.',
    optional: true,
    properties: {
      policyType: { type: 'string', description: 'EXPONENTIAL.' },
      maxRetryDuration: { type: 'number', description: 'Retry duration in milliseconds.' },
    },
  },
} as const

export const OCI_NOTIFICATIONS_TOPIC_PROPERTIES = {
  topicId: { type: 'string', description: 'Topic OCID.' },
  name: { type: 'string', description: 'Topic name.' },
  compartmentId: { type: 'string', description: 'Topic compartment OCID.' },
  lifecycleState: { type: 'string', description: 'ACTIVE, CREATING, or DELETING.' },
  timeCreated: { type: 'string', description: 'RFC3339 creation time.' },
  apiEndpoint: { type: 'string', description: 'Topic API endpoint; informational only.' },
  description: { type: 'string', description: 'Topic description.', optional: true },
  etag: { type: 'string', description: 'Resource ETag.', optional: true },
  shortTopicId: { type: 'string', description: 'Short topic code for SMS.', optional: true },
  ...OCI_NOTIFICATIONS_TAG_PROPERTIES,
  systemTags: { type: 'object', description: 'Namespaced system tags.', optional: true },
  locks: {
    type: 'array',
    description: 'Resource locks.',
    optional: true,
    items: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'FULL or DELETE.' },
        compartmentId: { type: 'string', description: 'Lock compartment OCID.' },
        message: { type: 'string', description: 'Lock reason.', optional: true },
        relatedResourceId: {
          type: 'string',
          description: 'Locking resource OCID.',
          optional: true,
        },
        timeCreated: { type: 'string', description: 'RFC3339 lock creation time.', optional: true },
      },
    },
  },
} as const

export const OCI_NOTIFICATIONS_SUBSCRIPTION_UPDATE_PROPERTIES = {
  ...OCI_NOTIFICATIONS_TAG_PROPERTIES,
  deliveryPolicy: {
    type: 'object',
    description: 'Subscription delivery policy.',
    properties: OCI_NOTIFICATIONS_DELIVERY_POLICY_PROPERTIES,
    optional: true,
  },
} as const

export const OCI_NOTIFICATIONS_SUBSCRIPTION_SUMMARY_PROPERTIES = {
  id: { type: 'string', description: 'Subscription OCID.' },
  topicId: { type: 'string', description: 'Parent topic OCID.' },
  compartmentId: { type: 'string', description: 'Subscription compartment OCID.' },
  protocol: { type: 'string', description: 'Delivery protocol.' },
  endpoint: { type: 'string', description: 'Configured delivery endpoint.' },
  lifecycleState: { type: 'string', description: 'PENDING, ACTIVE, or DELETED.' },
  createdTime: { type: 'number', description: 'Oracle creation time, unchanged.', optional: true },
  etag: { type: 'string', description: 'Resource ETag.', optional: true },
  ...OCI_NOTIFICATIONS_SUBSCRIPTION_UPDATE_PROPERTIES,
} as const

export const OCI_NOTIFICATIONS_SUBSCRIPTION_PROPERTIES = {
  ...OCI_NOTIFICATIONS_SUBSCRIPTION_SUMMARY_PROPERTIES,
  deliverPolicy: { type: 'string', description: 'Legacy JSON delivery policy.', optional: true },
} as const
