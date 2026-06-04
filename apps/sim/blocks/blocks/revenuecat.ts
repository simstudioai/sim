import { RevenueCatIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { RevenueCatResponse } from '@/tools/revenuecat/types'

export const RevenueCatBlock: BlockConfig<RevenueCatResponse> = {
  type: 'revenuecat',
  name: 'RevenueCat',
  description: 'Manage in-app subscriptions and entitlements',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate RevenueCat into the workflow. Manage subscribers, entitlements, offerings, and Google Play subscriptions. Retrieve customer subscription status, grant or revoke promotional entitlements, record purchases, update subscriber attributes, and manage Google Play subscription billing.',
  docsLink: 'https://docs.sim.ai/tools/revenuecat',
  category: 'tools',
  integrationType: IntegrationType.Ecommerce,
  tags: ['payments', 'subscriptions'],
  bgColor: '#F25A5A',
  icon: RevenueCatIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Customer', id: 'get_customer' },
        { label: 'Delete Customer', id: 'delete_customer' },
        { label: 'Create Purchase', id: 'create_purchase' },
        { label: 'Grant Entitlement', id: 'grant_entitlement' },
        { label: 'Revoke Entitlement', id: 'revoke_entitlement' },
        { label: 'List Offerings', id: 'list_offerings' },
        { label: 'Update Subscriber Attributes', id: 'update_subscriber_attributes' },
        { label: 'Defer Google Subscription', id: 'defer_google_subscription' },
        { label: 'Refund Google Subscription', id: 'refund_google_subscription' },
        { label: 'Revoke Google Subscription', id: 'revoke_google_subscription' },
      ],
      value: () => 'get_customer',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      password: true,
      placeholder: 'Enter your RevenueCat API key',
      required: true,
    },
    {
      id: 'appUserId',
      title: 'App User ID',
      type: 'short-input',
      placeholder: 'Enter the app user ID',
      required: true,
    },
    {
      id: 'entitlementIdentifier',
      title: 'Entitlement Identifier',
      type: 'short-input',
      placeholder: 'e.g., premium, pro',
      condition: {
        field: 'operation',
        value: ['grant_entitlement', 'revoke_entitlement'],
      },
      required: {
        field: 'operation',
        value: ['grant_entitlement', 'revoke_entitlement'],
      },
    },
    {
      id: 'duration',
      title: 'Duration',
      type: 'dropdown',
      options: [
        { label: 'Daily', id: 'daily' },
        { label: '3 Days', id: 'three_day' },
        { label: 'Weekly', id: 'weekly' },
        { label: '2 Weeks', id: 'two_week' },
        { label: 'Monthly', id: 'monthly' },
        { label: '2 Months', id: 'two_month' },
        { label: '3 Months', id: 'three_month' },
        { label: '6 Months', id: 'six_month' },
        { label: 'Yearly', id: 'yearly' },
        { label: 'Lifetime', id: 'lifetime' },
      ],
      value: () => 'monthly',
      condition: {
        field: 'operation',
        value: 'grant_entitlement',
      },
    },
    {
      id: 'endTimeMs',
      title: 'End Time (ms)',
      type: 'short-input',
      placeholder: 'Optional absolute end time in ms since epoch',
      condition: {
        field: 'operation',
        value: 'grant_entitlement',
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix epoch timestamp in milliseconds based on the user's description.
The timestamp should represent the absolute end time for the entitlement.
Examples:
- "in 7 days" -> current time plus 604800000 milliseconds
- "next month" -> current time plus 2592000000 milliseconds
- "end of 2026" -> 1798761600000

Return ONLY the numeric timestamp, no text.`,
      },
    },
    {
      id: 'startTimeMs',
      title: 'Start Time (ms)',
      type: 'short-input',
      placeholder: 'Optional start time in ms since epoch',
      condition: {
        field: 'operation',
        value: 'grant_entitlement',
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix epoch timestamp in milliseconds based on the user's description.
The timestamp should represent the start time of a promotional entitlement.
Setting a start time in the past allows shorter effective durations.
Examples:
- "right now" -> current time in milliseconds
- "1 hour ago" -> current time minus 3600000 milliseconds
- "yesterday" -> current time minus 86400000 milliseconds

Return ONLY the numeric timestamp, no text.`,
      },
    },
    {
      id: 'fetchToken',
      title: 'Fetch Token',
      type: 'short-input',
      placeholder: 'Store receipt or purchase token (e.g., sub_...)',
      condition: {
        field: 'operation',
        value: 'create_purchase',
      },
      required: {
        field: 'operation',
        value: 'create_purchase',
      },
    },
    {
      id: 'productId',
      title: 'Product ID / Store Transaction ID',
      type: 'short-input',
      placeholder:
        'Product ID, or store transaction ID for refunds (e.g., GPA.3309-9122-6177-45730)',
      condition: {
        field: 'operation',
        value: [
          'create_purchase',
          'defer_google_subscription',
          'refund_google_subscription',
          'revoke_google_subscription',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'defer_google_subscription',
          'refund_google_subscription',
          'revoke_google_subscription',
        ],
      },
    },
    {
      id: 'price',
      title: 'Price',
      type: 'short-input',
      placeholder: 'e.g., 9.99',
      condition: {
        field: 'operation',
        value: 'create_purchase',
      },
      mode: 'advanced',
    },
    {
      id: 'currency',
      title: 'Currency',
      type: 'short-input',
      placeholder: 'e.g., USD',
      condition: {
        field: 'operation',
        value: 'create_purchase',
      },
      mode: 'advanced',
    },
    {
      id: 'presentedOfferingIdentifier',
      title: 'Presented Offering ID',
      type: 'short-input',
      placeholder: 'Offering identifier shown to the user',
      condition: {
        field: 'operation',
        value: 'create_purchase',
      },
      mode: 'advanced',
    },
    {
      id: 'paymentMode',
      title: 'Payment Mode',
      type: 'dropdown',
      options: [
        { label: 'Pay As You Go', id: 'pay_as_you_go' },
        { label: 'Pay Up Front', id: 'pay_up_front' },
        { label: 'Free Trial', id: 'free_trial' },
      ],
      condition: {
        field: 'operation',
        value: 'create_purchase',
      },
      mode: 'advanced',
    },
    {
      id: 'introductoryPrice',
      title: 'Introductory Price',
      type: 'short-input',
      placeholder: 'e.g., 0.99',
      condition: {
        field: 'operation',
        value: 'create_purchase',
      },
      mode: 'advanced',
    },
    {
      id: 'updatedAtMs',
      title: 'Updated At (ms)',
      type: 'short-input',
      placeholder: 'Unix epoch ms used to resolve attribute conflicts',
      condition: {
        field: 'operation',
        value: 'create_purchase',
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix epoch timestamp in milliseconds based on the user's description.
Used by RevenueCat to resolve attribute conflicts on a posted purchase.

Return ONLY the numeric timestamp, no text.`,
      },
    },
    {
      id: 'isRestore',
      title: 'Is Restore',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: {
        field: 'operation',
        value: 'create_purchase',
      },
      mode: 'advanced',
    },
    {
      id: 'purchasePlatform',
      title: 'Platform',
      type: 'dropdown',
      options: [
        { label: 'iOS', id: 'ios' },
        { label: 'Android', id: 'android' },
        { label: 'Amazon', id: 'amazon' },
        { label: 'macOS', id: 'macos' },
        { label: 'UIKit for Mac', id: 'uikitformac' },
        { label: 'Stripe', id: 'stripe' },
        { label: 'Roku', id: 'roku' },
        { label: 'Paddle', id: 'paddle' },
      ],
      condition: {
        field: 'operation',
        value: 'create_purchase',
      },
      required: {
        field: 'operation',
        value: 'create_purchase',
      },
    },
    {
      id: 'attributes',
      title: 'Attributes',
      type: 'long-input',
      placeholder: '{"$email": {"value": "user@example.com", "updated_at_ms": 1709195668093}}',
      condition: {
        field: 'operation',
        value: ['update_subscriber_attributes', 'create_purchase'],
      },
      required: {
        field: 'operation',
        value: 'update_subscriber_attributes',
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object of RevenueCat subscriber attributes based on the user's description.
Each attribute key maps to an object with a "value" field (string) and an "updated_at_ms" field (Unix epoch ms; required by the API for conflict resolution — use the current timestamp unless the user specifies otherwise).
Reserved attribute keys start with "$": $email, $displayName, $phoneNumber, $mediaSource, $campaign, $adGroup, $ad, $keyword, $creative, $iterableUserId, $iterableCampaignId, $iterableTemplateId, $onesignalId, $airshipChannelId, $cleverTapId, $firebaseAppInstanceId.
Custom attributes use plain keys without "$".

Examples:
- "set email to john@example.com and name to John" ->
  {"$email": {"value": "john@example.com", "updated_at_ms": 1709195668093}, "$displayName": {"value": "John", "updated_at_ms": 1709195668093}}
- "set plan to premium and team to acme" ->
  {"plan": {"value": "premium", "updated_at_ms": 1709195668093}, "team": {"value": "acme", "updated_at_ms": 1709195668093}}

Return ONLY valid JSON - no explanations, no extra text.`,
      },
    },
    {
      id: 'extendByDays',
      title: 'Extend By Days',
      type: 'short-input',
      placeholder: 'Number of days to extend (1-365)',
      condition: {
        field: 'operation',
        value: 'defer_google_subscription',
      },
    },
    {
      id: 'expiryTimeMs',
      title: 'Expiry Time (ms)',
      type: 'short-input',
      placeholder: 'Absolute new expiry time in ms since epoch',
      condition: {
        field: 'operation',
        value: 'defer_google_subscription',
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix epoch timestamp in milliseconds based on the user's description.
The timestamp should represent the new absolute expiry time of the subscription.

Return ONLY the numeric timestamp, no text.`,
      },
    },
    {
      id: 'platform',
      title: 'Platform',
      type: 'dropdown',
      options: [
        { label: 'iOS', id: 'ios' },
        { label: 'Android', id: 'android' },
        { label: 'Amazon', id: 'amazon' },
        { label: 'Stripe', id: 'stripe' },
        { label: 'Roku', id: 'roku' },
        { label: 'Paddle', id: 'paddle' },
      ],
      condition: {
        field: 'operation',
        value: 'list_offerings',
      },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'revenuecat_get_customer',
      'revenuecat_delete_customer',
      'revenuecat_create_purchase',
      'revenuecat_grant_entitlement',
      'revenuecat_revoke_entitlement',
      'revenuecat_list_offerings',
      'revenuecat_update_subscriber_attributes',
      'revenuecat_defer_google_subscription',
      'revenuecat_refund_google_subscription',
      'revenuecat_revoke_google_subscription',
    ],
    config: {
      tool: (params) => `revenuecat_${params.operation}`,
      params: (params) => {
        const next: Record<string, unknown> = { ...params }
        if (params.purchasePlatform && params.operation === 'create_purchase') {
          next.platform = params.purchasePlatform
        }
        next.purchasePlatform = undefined
        if (params.productId && params.operation === 'refund_google_subscription') {
          next.storeTransactionId = params.productId
          next.productId = undefined
        }
        if (params.isRestore !== undefined && params.isRestore !== '') {
          next.isRestore = params.isRestore === true || params.isRestore === 'true'
        }
        if (params.price !== undefined && params.price !== '') {
          next.price = Number(params.price)
        }
        if (params.extendByDays !== undefined && params.extendByDays !== '') {
          next.extendByDays = Number(params.extendByDays)
        }
        if (params.startTimeMs !== undefined && params.startTimeMs !== '') {
          next.startTimeMs = Number(params.startTimeMs)
        }
        if (params.endTimeMs !== undefined && params.endTimeMs !== '') {
          const endTimeMs = Number(params.endTimeMs)
          if (Number.isFinite(endTimeMs)) {
            next.endTimeMs = endTimeMs
            next.duration = undefined
          }
        }
        if (params.expiryTimeMs !== undefined && params.expiryTimeMs !== '') {
          const expiryTimeMs = Number(params.expiryTimeMs)
          if (Number.isFinite(expiryTimeMs)) {
            next.expiryTimeMs = expiryTimeMs
            next.extendByDays = undefined
          }
        }
        if (params.introductoryPrice !== undefined && params.introductoryPrice !== '') {
          next.introductoryPrice = Number(params.introductoryPrice)
        }
        if (params.updatedAtMs !== undefined && params.updatedAtMs !== '') {
          next.updatedAtMs = Number(params.updatedAtMs)
        }
        return next
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'RevenueCat API key' },
    appUserId: { type: 'string', description: 'App user ID' },
    entitlementIdentifier: { type: 'string', description: 'Entitlement identifier' },
    duration: { type: 'string', description: 'Promotional entitlement duration' },
    startTimeMs: { type: 'number', description: 'Custom start time in ms since epoch' },
    fetchToken: { type: 'string', description: 'Store receipt or purchase token' },
    productId: {
      type: 'string',
      description: 'Product identifier (or store transaction ID for refunds)',
    },
    price: { type: 'number', description: 'Product price' },
    currency: { type: 'string', description: 'ISO 4217 currency code' },
    isRestore: { type: 'boolean', description: 'Whether this is a restore purchase' },
    presentedOfferingIdentifier: {
      type: 'string',
      description: 'Identifier of the offering presented to the user',
    },
    paymentMode: {
      type: 'string',
      description: 'Payment mode (pay_as_you_go, pay_up_front, free_trial)',
    },
    attributes: {
      type: 'string',
      description:
        'JSON object of subscriber attributes (used by update_subscriber_attributes and create_purchase)',
    },
    introductoryPrice: { type: 'number', description: 'Introductory price for the purchase' },
    updatedAtMs: {
      type: 'number',
      description: 'Unix epoch ms used by RevenueCat to resolve attribute conflicts',
    },
    extendByDays: { type: 'number', description: 'Number of days to extend (1-365)' },
    expiryTimeMs: { type: 'number', description: 'Absolute new expiry time in ms since epoch' },
    endTimeMs: {
      type: 'number',
      description: 'Absolute end time for entitlement in ms since epoch',
    },
    platform: { type: 'string', description: 'Platform (X-Platform header)' },
  },
  outputs: {
    subscriber: {
      type: 'json',
      description:
        'Subscriber object (first_seen, original_app_user_id, original_purchase_date, management_url, subscriptions, entitlements, non_subscriptions)',
    },
    offerings: {
      type: 'json',
      description: 'Array of offerings, each with identifier, description, and packages[]',
    },
    current_offering_id: { type: 'string', description: 'Current offering identifier' },
    metadata: {
      type: 'json',
      description:
        'Operation metadata. For get_customer: app_user_id, first_seen, active_entitlements, active_subscriptions. For list_offerings: count, current_offering_id.',
    },
    deleted: { type: 'boolean', description: 'Whether the subscriber was deleted' },
    app_user_id: { type: 'string', description: 'The app user ID' },
    updated: { type: 'boolean', description: 'Whether the attributes were updated' },
    customer: {
      type: 'json',
      description: 'Customer object returned by create_purchase (when present in the response)',
    },
  },
}
