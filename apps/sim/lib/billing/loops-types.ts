/**
 * Type definitions for Loops SDK
 * These types define the expected structure of Loops API responses
 */

export interface LoopsCheckoutSession {
  id: string
  url?: string
  checkoutUrl?: string
  status?: string
  paymentLinkId: string
  externalCustomerId?: string
  metadata?: Record<string, string>
}

export interface LoopsCheckoutSessionCreateParams {
  paymentLinkId: string
  externalCustomerId: string
  metadata?: Record<string, string>
}

export interface LoopsSubscription {
  id: string
  status: string
  customerId: string
  metadata?: Record<string, string>
}

export interface LoopsWebhookEvent {
  type: string
  id: string
  data: {
    subscription?: {
      id: string
      status: string
      metadata?: Record<string, string>
    }
    checkout?: {
      id: string
      status: string
      metadata?: Record<string, string>
    }
    [key: string]: any
  }
}

export interface LoopsCustomer {
  id: string
  email?: string
  metadata?: Record<string, string>
}

export interface LoopsInvoice {
  id: string
  customerId: string
  amount: number
  status: string
  metadata?: Record<string, string>
}
