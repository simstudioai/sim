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
  expires_date: {
    type: 'string',
    description: 'ISO 8601 expiration date (null for non-expiring entitlements)',
    optional: true,
  },
  grace_period_expires_date: {
    type: 'string',
    description: 'ISO 8601 grace period expiration date',
    optional: true,
  },
  product_identifier: { type: 'string', description: 'Product identifier', optional: true },
  purchase_date: {
    type: 'string',
    description: 'ISO 8601 date of the latest purchase or renewal',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const SUBSCRIBER_OUTPUT_PROPERTIES = {
  first_seen: { type: 'string', description: 'ISO 8601 date when subscriber was first seen' },
  last_seen: {
    type: 'string',
    description: 'ISO 8601 date when subscriber was last seen',
    optional: true,
  },
  original_app_user_id: { type: 'string', description: 'Original app user ID' },
  original_application_version: {
    type: 'string',
    description: 'iOS only. First App Store version of your app the customer installed',
    optional: true,
  },
  original_purchase_date: {
    type: 'string',
    description: 'iOS only. Date the app was first purchased/downloaded',
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
  other_purchases: {
    type: 'object',
    description: 'Other purchases attached to the subscriber',
    optional: true,
  },
  subscriber_attributes: {
    type: 'object',
    description:
      'Custom attributes set on the subscriber. Only returned when using a secret API key',
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
 * Several RevenueCat v1 endpoints (post receipts, update attributes, revoke promotionals,
 * defer/refund/revoke Google subscriptions) wrap responses in `{ value: { request_date, subscriber } }`.
 * GET customer info returns the same payload unwrapped. This helper handles both shapes.
 */
export function extractSubscriber(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object') return {}
  const root = data as Record<string, unknown>
  const wrapped = root.value as Record<string, unknown> | undefined
  const subscriber = (wrapped?.subscriber ?? root.subscriber) as Record<string, unknown> | undefined
  return subscriber ?? {}
}

/**
 * POST /v1/receipts may return a top-level `customer` object alongside `subscriber`.
 * Returns null when not present (e.g., wrapped envelope responses).
 */
export function extractCustomer(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object') return null
  const customer = (data as Record<string, unknown>).customer
  return customer && typeof customer === 'object' ? (customer as Record<string, unknown>) : null
}

/**
 * Parse a RevenueCat REST API error response into a meaningful Error.
 * RevenueCat returns `{ code, message }` on 4xx/5xx.
 */
export async function throwIfRevenueCatError(response: Response): Promise<void> {
  if (response.ok) return
  let message = `RevenueCat API error (${response.status})`
  try {
    const body = await response.clone().json()
    if (body && typeof body === 'object') {
      const m = (body as Record<string, unknown>).message
      const c = (body as Record<string, unknown>).code
      if (typeof m === 'string' && m.length > 0) {
        message = c ? `${m} (code ${c})` : m
      }
    }
  } catch {
    // Body not JSON — fall back to status-only message
  }
  throw new Error(message)
}

/**
 * Base params interface for RevenueCat API calls
 */
interface RevenueCatBaseParams {
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
  duration?: string
  endTimeMs?: number
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
  productId?: string
  price?: number
  currency?: string
  isRestore?: boolean
  presentedOfferingIdentifier?: string
  paymentMode?: string
  introductoryPrice?: number
  attributes?: string
  updatedAtMs?: number
  platform: string
}

export interface UpdateSubscriberAttributesParams extends RevenueCatBaseParams {
  appUserId: string
  attributes: string
}

export interface DeferGoogleSubscriptionParams extends RevenueCatBaseParams {
  appUserId: string
  productId: string
  extendByDays?: number
  expiryTimeMs?: number
}

export interface RefundGoogleSubscriptionParams extends RevenueCatBaseParams {
  appUserId: string
  storeTransactionId: string
}

export interface RevokeGoogleSubscriptionParams extends RevenueCatBaseParams {
  appUserId: string
  productId: string
}

export interface RevenueCatSubscriber {
  first_seen: string
  last_seen: string | null
  original_app_user_id: string
  original_application_version: string | null
  original_purchase_date: string | null
  management_url: string | null
  subscriptions: Record<string, unknown>
  entitlements: Record<string, unknown>
  non_subscriptions: Record<string, unknown>
  other_purchases: Record<string, unknown>
  subscriber_attributes: Record<string, unknown> | null
}

export function shapeSubscriber(raw: Record<string, unknown>): RevenueCatSubscriber {
  return {
    first_seen: (raw.first_seen as string) ?? '',
    last_seen: (raw.last_seen as string | null) ?? null,
    original_app_user_id: (raw.original_app_user_id as string) ?? '',
    original_application_version: (raw.original_application_version as string | null) ?? null,
    original_purchase_date: (raw.original_purchase_date as string | null) ?? null,
    management_url: (raw.management_url as string | null) ?? null,
    subscriptions: (raw.subscriptions as Record<string, unknown>) ?? {},
    entitlements: (raw.entitlements as Record<string, unknown>) ?? {},
    non_subscriptions: (raw.non_subscriptions as Record<string, unknown>) ?? {},
    other_purchases: (raw.other_purchases as Record<string, unknown>) ?? {},
    subscriber_attributes: (raw.subscriber_attributes as Record<string, unknown> | null) ?? null,
  }
}

export interface CustomerResponse extends ToolResponse {
  output: {
    subscriber: RevenueCatSubscriber
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
    subscriber: RevenueCatSubscriber
  }
}

export interface RevokeEntitlementResponse extends ToolResponse {
  output: {
    subscriber: RevenueCatSubscriber
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
    customer: Record<string, unknown> | null
    subscriber: RevenueCatSubscriber
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
    subscriber: RevenueCatSubscriber
  }
}

export interface RefundGoogleSubscriptionResponse extends ToolResponse {
  output: {
    subscriber: RevenueCatSubscriber
  }
}

export interface RevokeGoogleSubscriptionResponse extends ToolResponse {
  output: {
    subscriber: RevenueCatSubscriber
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
