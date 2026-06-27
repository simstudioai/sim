/**
 * Stripe API integration types and shared utilities.
 */

export interface StripeCredentials {
  apiKey: string
}

export interface StripeErrorResponse {
  error: {
    code?: string
    type: string
    message: string
  }
}

export function transformStripeError(response: unknown): string {
  if (response && typeof response === 'object' && 'error' in response) {
    const err = response as StripeErrorResponse
    return err.error?.message ?? 'Unknown error'
  }
  return 'Request failed'
}
