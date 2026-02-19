import { RevenueCatIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
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
      title: 'Product ID',
      type: 'short-input',
      placeholder: 'Product identifier',
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
          'create_purchase',
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
        { label: 'Stripe', id: 'stripe' },
      ],
      condition: {
        field: 'operation',
        value: 'create_purchase',
      },
      mode: 'advanced',
    },
    {
      id: 'attributes',
      title: 'Attributes',
      type: 'long-input',
      placeholder: '{"$email": {"value": "user@example.com"}}',
      condition: {
        field: 'operation',
        value: 'update_subscriber_attributes',
      },
      required: {
        field: 'operation',
        value: 'update_subscriber_attributes',
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object of RevenueCat subscriber attributes based on the user's description.
Each attribute key maps to an object with a "value" field.
Reserved attribute keys start with "$": $email, $displayName, $phoneNumber, $mediaSource, $campaign, $adGroup, $ad, $keyword, $creative, $iterableUserId, $iterableCampaignId, $iterableTemplateId, $onesignalId, $airshipChannelId, $cleverTapId, $firebaseAppInstanceId.
Custom attributes use plain keys without "$".

Examples:
- "set email to john@example.com and name to John" ->
  {"$email": {"value": "john@example.com"}, "$displayName": {"value": "John"}}
- "set plan to premium and team to acme" ->
  {"plan": {"value": "premium"}, "team": {"value": "acme"}}

Return ONLY valid JSON.`,
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
      required: {
        field: 'operation',
        value: 'defer_google_subscription',
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
        { label: 'macOS', id: 'macos' },
        { label: 'Stripe', id: 'stripe' },
      ],
      condition: {
        field: 'operation',
        value: 'list_offerings',
      },
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
      tool: (params) => {
        if (params.purchasePlatform && params.operation === 'create_purchase') {
          params.platform = params.purchasePlatform
        }
        if (params.isRestore !== undefined) {
          params.isRestore = params.isRestore === 'true'
        }
        return `revenuecat_${params.operation}`
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
    productId: { type: 'string', description: 'Product identifier' },
    price: { type: 'number', description: 'Product price' },
    currency: { type: 'string', description: 'ISO 4217 currency code' },
    isRestore: { type: 'boolean', description: 'Whether this is a restore purchase' },
    purchasePlatform: { type: 'string', description: 'Platform for the purchase' },
    attributes: { type: 'string', description: 'JSON object of subscriber attributes' },
    extendByDays: { type: 'number', description: 'Number of days to extend (1-365)' },
    platform: { type: 'string', description: 'Platform filter for offerings' },
  },
  outputs: {
    subscriber: {
      type: 'json',
      description: 'Subscriber object with subscriptions and entitlements',
    },
    offerings: {
      type: 'json',
      description: 'Array of offerings with packages',
    },
    current_offering_id: { type: 'string', description: 'Current offering identifier' },
    metadata: { type: 'json', description: 'Operation metadata' },
    deleted: { type: 'boolean', description: 'Whether the subscriber was deleted' },
    app_user_id: { type: 'string', description: 'The app user ID' },
    updated: { type: 'boolean', description: 'Whether the attributes were updated' },
  },
}
