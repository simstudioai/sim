/**
 * Stripe API integration types and shared utilities.
 * @see https://stripe.com/docs/api
 */

export type StripeResource =
  | 'core'
  | 'customers'
  | 'subscriptions'
  | 'charges'
  | 'payments'
  | 'payment_methods'
  | 'invoices'
  | 'products'
  | 'coupons'
  | 'refunds'
  | 'transfers'
  | 'disputes'
  | 'sources'
  | 'webhooks'
  | 'files'
  | 'financial'
  | 'tax'
  | 'billing_portal'
  | 'checkout'
  | 'advanced'

export interface StripeCredentials {
  apiKey: string
}

export interface StripeErrorResponse {
  error: {
    code?: string
    type: string
    message: string
    doc_url?: string
    param?: string
  }
}

export interface StripePaginationResponse {
  data: Record<string, unknown>[]
  has_more: boolean
  url?: string
  object?: string
}

/**
 * Transform Stripe paginated response to expose pagination metadata.
 */
export function transformStripeResponse(response: unknown) {
  if (response && typeof response === 'object' && 'data' in response) {
    const paginated = response as StripePaginationResponse
    return {
      items: paginated.data,
      hasMore: paginated.has_more,
      nextCursor: paginated.data.length > 0 ? (paginated.data[paginated.data.length - 1] as any)?.id : undefined,
    }
  }
  return response
}
