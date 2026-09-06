import { z } from 'zod'

/** Oracle Notifications 20181201: https://docs.oracle.com/en-us/iaas/api/#/en/notification/ */
export const OCI_NOTIFICATIONS_MAX_PUBLISH_BYTES = 64_000

const identifier = z.string().trim().min(1).max(255)
const auth = { oauthCredential: identifier, region: identifier.optional() }
const topic = { ...auth, topicId: identifier }
const subscription = { ...topic, subscriptionId: identifier }
const tags = {
  freeformTags: z.record(z.string(), z.string()).optional(),
  definedTags: z.record(z.string(), z.record(z.string(), z.string())).optional(),
}
const paging = {
  limit: z.number().int().min(1).max(50).optional(),
  page: z.string().min(1).optional(),
}
const ifMatch = z.string().min(1).optional()
const retryToken = z.string().min(1).max(64).optional()
const isLockOverride = z.boolean().optional()

export const ociNotificationsLockSchema = z.object({
  type: z.enum(['FULL', 'DELETE']),
  compartmentId: identifier,
  message: z.string().optional(),
  relatedResourceId: identifier.optional(),
  timeCreated: z.iso.datetime({ offset: true }).optional(),
})

export const ociNotificationsDeliveryPolicySchema = z.object({
  backoffRetryPolicy: z
    .object({
      maxRetryDuration: z.number().int().min(60_000).max(7_200_000),
      policyType: z.literal('EXPONENTIAL'),
    })
    .optional(),
})

export const ociNotificationsInputSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('oci_notifications_list_topics'),
    ...auth,
    ...paging,
    compartmentId: identifier,
    id: z.string().min(1).max(1024).optional(),
    name: z.string().min(1).max(1024).optional(),
    lifecycleState: z.enum(['ACTIVE', 'DELETING', 'CREATING']).optional(),
    sortBy: z.enum(['TIMECREATED', 'LIFECYCLESTATE']).optional(),
    sortOrder: z.enum(['ASC', 'DESC']).optional(),
  }),
  z.object({ operation: z.literal('oci_notifications_get_topic'), ...topic }),
  z.object({
    operation: z.literal('oci_notifications_create_topic'),
    ...auth,
    ...tags,
    compartmentId: identifier,
    name: z.string().trim().min(1).max(256),
    description: z.string().max(256).optional(),
    retryToken,
  }),
  z.object({
    operation: z.literal('oci_notifications_update_topic'),
    ...topic,
    ...tags,
    description: z.string().max(256),
    ifMatch,
    isLockOverride,
  }),
  z.object({
    operation: z.literal('oci_notifications_delete_topic'),
    ...topic,
    ifMatch,
    isLockOverride,
  }),
  z.object({
    operation: z.literal('oci_notifications_change_topic_compartment'),
    ...topic,
    destinationCompartmentId: identifier,
    ifMatch,
    retryToken,
    isLockOverride,
  }),
  z.object({
    operation: z.literal('oci_notifications_add_topic_lock'),
    ...topic,
    lock: ociNotificationsLockSchema,
    ifMatch,
  }),
  z.object({
    operation: z.literal('oci_notifications_remove_topic_lock'),
    ...topic,
    lock: ociNotificationsLockSchema,
    ifMatch,
  }),
  z.object({
    operation: z.literal('oci_notifications_list_subscriptions'),
    ...topic,
    ...paging,
    compartmentId: identifier,
  }),
  z.object({ operation: z.literal('oci_notifications_get_subscription'), ...subscription }),
  z.object({
    operation: z.literal('oci_notifications_create_subscription'),
    ...topic,
    ...tags,
    protocol: z.enum(['EMAIL', 'CUSTOM_HTTPS', 'ORACLE_FUNCTIONS', 'PAGERDUTY', 'SLACK', 'SMS']),
    endpoint: z.string().trim().min(1).max(512),
    metadata: z.string().max(1024).optional(),
    retryToken,
  }),
  z.object({
    operation: z.literal('oci_notifications_update_subscription'),
    ...subscription,
    ...tags,
    deliveryPolicy: ociNotificationsDeliveryPolicySchema.optional(),
    ifMatch,
  }),
  z.object({
    operation: z.literal('oci_notifications_delete_subscription'),
    ...subscription,
    ifMatch,
  }),
  z.object({
    operation: z.literal('oci_notifications_change_subscription_compartment'),
    ...subscription,
    destinationCompartmentId: identifier,
    ifMatch,
    retryToken,
  }),
  z.object({
    operation: z.literal('oci_notifications_resend_subscription_confirmation'),
    ...subscription,
  }),
  z.object({
    operation: z.literal('oci_notifications_publish_message'),
    ...topic,
    body: z.string().min(1),
    title: z.string().max(255).optional(),
  }),
])

export type OciNotificationsInput = z.infer<typeof ociNotificationsInputSchema>

export const ociNotificationsTopicSchema = z.object({
  topicId: z.string(),
  name: z.string(),
  compartmentId: z.string(),
  lifecycleState: z.string(),
  timeCreated: z.string(),
  apiEndpoint: z.string(),
  description: z.string().optional(),
  etag: z.string().optional(),
  shortTopicId: z.string().optional(),
  locks: z.array(ociNotificationsLockSchema).optional(),
  ...tags,
  systemTags: z.record(z.string(), z.record(z.string(), z.string())).optional(),
})

export const ociNotificationsSubscriptionUpdateSchema = z.object({
  ...tags,
  deliveryPolicy: ociNotificationsDeliveryPolicySchema.optional(),
})

export const ociNotificationsSubscriptionSummarySchema =
  ociNotificationsSubscriptionUpdateSchema.extend({
    id: z.string(),
    topicId: z.string(),
    compartmentId: z.string(),
    protocol: z.string(),
    endpoint: z.string(),
    lifecycleState: z.string(),
    createdTime: z.number().int().safe().optional(),
    etag: z.string().optional(),
  })

export const ociNotificationsSubscriptionSchema = ociNotificationsSubscriptionSummarySchema.extend({
  deliverPolicy: z.string().optional(),
})

export const ociNotificationsPublishSchema = z.object({
  messageId: z.string().min(1),
  timeStamp: z.string().optional(),
})
