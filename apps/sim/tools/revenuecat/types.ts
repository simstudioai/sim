import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for RevenueCat API responses.
 * Based on official RevenueCat API v1 documentation.
 */

export const SUBSCRIPTION_OUTPUT_PROPERTIES = {
  store_transaction_id: {
    type: 'string',
    description: 'Store transaction identifier',
    optional: true,
  },
  original_transaction_id: {
    type: 'string',
    description: 'Original transaction identifier',
    optional: true,
  },
  purchase_date: { type: 'string', description: 'ISO 8601 purchase date', optional: true },
  original_purchase_date: {
    type: 'string',
    description: 'ISO 8601 date of the original purchase',
    optional: true,
  },
  expires_date: { type: 'string', description: 'ISO 8601 expiration date', optional: true },
  is_sandbox: {
    type: 'boolean',
    description: 'Whether this is a sandbox purchase',
    optional: true,
  },
  unsubscribe_detected_at: {
    type: 'string',
    description: 'ISO 8601 date when unsubscribe was detected',
    optional: true,
  },
  billing_issues_detected_at: {
    type: 'string',
    description: 'ISO 8601 date when billing issues were detected',
    optional: true,
  },
  grace_period_expires_date: {
    type: 'string',
    description: 'ISO 8601 grace period expiration date',
    optional: true,
  },
  ownership_type: {
    type: 'string',
    description: 'Ownership type (purchased, family_shared)',
    optional: true,
  },
  period_type: {
    type: 'string',
    description: 'Period type (normal, trial, intro, promotional, prepaid)',
    optional: true,
  },
  store: {
    type: 'string',
    description: 'Store the subscription was purchased from (app_store, play_store, stripe, etc.)',
    optional: true,
  },
  refunded_at: {
    type: 'string',
    description: 'ISO 8601 date when subscription was refunded',
    optional: true,
  },
  auto_resume_date: {
    type: 'string',
    description: 'ISO 8601 date when a paused subscription will auto-resume',
    optional: true,
  },
  product_plan_identifier: {
    type: 'string',
    description: 'Google Play base plan identifier (for products set up after Feb 2023)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const ENTITLEMENT_OUTPUT_PROPERTIES = {
  grant_date: { type: 'string', description: 'ISO 8601 grant date', optional: true },
  expires_date: { type: 'string', description: 'ISO 8601 expiration date', optional: true },
  product_identifier: { type: 'string', description: 'Product identifier', optional: true },
  is_active: { type: 'boolean', description: 'Whether the entitlement is active' },
  will_renew: {
    type: 'boolean',
    description: 'Whether the entitlement will renew',
    optional: true,
  },
  period_type: {
    type: 'string',
    description: 'Period type (normal, trial, intro, promotional)',
    optional: true,
  },
  purchase_date: {
    type: 'string',
    description: 'ISO 8601 date of the latest purchase or renewal',
    optional: true,
  },
  store: {
    type: 'string',
    description: 'Store the entitlement was granted from',
    optional: true,
  },
  grace_period_expires_date: {
    type: 'string',
    description: 'ISO 8601 grace period expiration date',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const SUBSCRIBER_OUTPUT_PROPERTIES = {
  first_seen: { type: 'string', description: 'ISO 8601 date when subscriber was first seen' },
  original_app_user_id: { type: 'string', description: 'Original app user ID' },
  original_purchase_date: {
    type: 'string',
    description: 'ISO 8601 date of original purchase',
    optional: true,
  },
  management_url: {
    type: 'string',
    description: 'URL for managing the subscriber subscriptions',
    optional: true,
  },
  subscriptions: {
    type: 'object',
    description: 'Map of product identifiers to subscription objects',
    properties: SUBSCRIPTION_OUTPUT_PROPERTIES,
  },
  entitlements: {
    type: 'object',
    description: 'Map of entitlement identifiers to entitlement objects',
    properties: ENTITLEMENT_OUTPUT_PROPERTIES,
  },
  non_subscriptions: {
    type: 'object',
    description: 'Map of non-subscription product identifiers to arrays of purchase objects',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const SUBSCRIBER_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'RevenueCat subscriber object',
  properties: SUBSCRIBER_OUTPUT_PROPERTIES,
}

export const OFFERING_PACKAGE_OUTPUT_PROPERTIES = {
  identifier: { type: 'string', description: 'Package identifier' },
  platform_product_identifier: {
    type: 'string',
    description: 'Platform-specific product identifier',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const OFFERING_OUTPUT_PROPERTIES = {
  identifier: { type: 'string', description: 'Offering identifier' },
  description: { type: 'string', description: 'Offering description', optional: true },
  packages: {
    type: 'array',
    description: 'List of packages in the offering',
    items: {
      type: 'object',
      properties: OFFERING_PACKAGE_OUTPUT_PROPERTIES,
    },
  },
} as const satisfies Record<string, OutputProperty>

export const DELETE_OUTPUT_PROPERTIES = {
  deleted: { type: 'boolean', description: 'Whether the subscriber was deleted' },
  app_user_id: { type: 'string', description: 'The deleted app user ID' },
} as const satisfies Record<string, OutputProperty>

export const METADATA_OUTPUT_PROPERTIES = {
  app_user_id: { type: 'string', description: 'The app user ID' },
  first_seen: { type: 'string', description: 'ISO 8601 date when the subscriber was first seen' },
  active_entitlements: { type: 'number', description: 'Number of active entitlements' },
  active_subscriptions: { type: 'number', description: 'Number of active subscriptions' },
} as const satisfies Record<string, OutputProperty>

export const OFFERINGS_METADATA_OUTPUT_PROPERTIES = {
  count: { type: 'number', description: 'Number of offerings returned' },
  current_offering_id: {
    type: 'string',
    description: 'Current offering identifier',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Base params interface for RevenueCat API calls
 */
export interface RevenueCatBaseParams {
  apiKey: string
}

export interface GetCustomerParams extends RevenueCatBaseParams {
  appUserId: string
}

export interface DeleteCustomerParams extends RevenueCatBaseParams {
  appUserId: string
}

export interface GrantEntitlementParams extends RevenueCatBaseParams {
  appUserId: string
  entitlementIdentifier: string
  duration: string
  startTimeMs?: number
}

export interface RevokeEntitlementParams extends RevenueCatBaseParams {
  appUserId: string
  entitlementIdentifier: string
}

export interface ListOfferingsParams extends RevenueCatBaseParams {
  appUserId: string
  platform?: string
}

export interface CreatePurchaseParams extends RevenueCatBaseParams {
  appUserId: string
  fetchToken: string
  productId: string
  price?: number
  currency?: string
  isRestore?: boolean
  platform?: string
}

export interface UpdateSubscriberAttributesParams extends RevenueCatBaseParams {
  appUserId: string
  attributes: string
}

export interface DeferGoogleSubscriptionParams extends RevenueCatBaseParams {
  appUserId: string
  productId: string
  extendByDays: number
}

export interface RefundGoogleSubscriptionParams extends RevenueCatBaseParams {
  appUserId: string
  productId: string
}

export interface RevokeGoogleSubscriptionParams extends RevenueCatBaseParams {
  appUserId: string
  productId: string
}

export interface CustomerResponse extends ToolResponse {
  output: {
    subscriber: {
      first_seen: string
      original_app_user_id: string
      original_purchase_date: string | null
      management_url: string | null
      subscriptions: Record<string, unknown>
      entitlements: Record<string, unknown>
      non_subscriptions: Record<string, unknown>
    }
    metadata: {
      app_user_id: string
      first_seen: string
      active_entitlements: number
      active_subscriptions: number
    }
  }
}

export interface DeleteCustomerResponse extends ToolResponse {
  output: {
    deleted: boolean
    app_user_id: string
  }
}

export interface GrantEntitlementResponse extends ToolResponse {
  output: {
    subscriber: {
      first_seen: string
      original_app_user_id: string
      subscriptions: Record<string, unknown>
      entitlements: Record<string, unknown>
    }
  }
}

export interface RevokeEntitlementResponse extends ToolResponse {
  output: {
    subscriber: {
      first_seen: string
      original_app_user_id: string
      subscriptions: Record<string, unknown>
      entitlements: Record<string, unknown>
    }
  }
}

export interface ListOfferingsResponse extends ToolResponse {
  output: {
    current_offering_id: string | null
    offerings: Array<{
      identifier: string
      description: string | null
      packages: Array<{
        identifier: string
        platform_product_identifier: string | null
      }>
    }>
    metadata: {
      count: number
      current_offering_id: string | null
    }
  }
}

export interface CreatePurchaseResponse extends ToolResponse {
  output: {
    subscriber: {
      first_seen: string
      original_app_user_id: string
      subscriptions: Record<string, unknown>
      entitlements: Record<string, unknown>
      non_subscriptions: Record<string, unknown>
    }
  }
}

export interface UpdateSubscriberAttributesResponse extends ToolResponse {
  output: {
    updated: boolean
    app_user_id: string
  }
}

export interface DeferGoogleSubscriptionResponse extends ToolResponse {
  output: {
    subscriber: {
      first_seen: string
      original_app_user_id: string
      subscriptions: Record<string, unknown>
      entitlements: Record<string, unknown>
    }
  }
}

export interface RefundGoogleSubscriptionResponse extends ToolResponse {
  output: {
    subscriber: {
      first_seen: string
      original_app_user_id: string
      subscriptions: Record<string, unknown>
      entitlements: Record<string, unknown>
    }
  }
}

export interface RevokeGoogleSubscriptionResponse extends ToolResponse {
  output: {
    subscriber: {
      first_seen: string
      original_app_user_id: string
      subscriptions: Record<string, unknown>
      entitlements: Record<string, unknown>
    }
  }
}

export type RevenueCatResponse =
  | CustomerResponse
  | DeleteCustomerResponse
  | GrantEntitlementResponse
  | RevokeEntitlementResponse
  | ListOfferingsResponse
  | CreatePurchaseResponse
  | UpdateSubscriberAttributesResponse
  | DeferGoogleSubscriptionResponse
  | RefundGoogleSubscriptionResponse
  | RevokeGoogleSubscriptionResponse
