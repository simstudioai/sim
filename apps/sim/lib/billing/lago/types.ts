export type LagoBillingEntityType = 'user' | 'organization'

export interface LagoCustomerPayload {
  external_id: string
  name?: string
  email?: string
  currency?: string
  billing_configuration?: {
    payment_provider?: string
    provider_customer_id?: string
    sync?: boolean
  }
}

export interface LagoCustomerResponse {
  customer: {
    lago_id: string
    external_id: string
    name: string | null
    email: string | null
  }
}

export interface LagoSubscriptionPayload {
  external_customer_id: string
  plan_code: string
  external_id: string
  name?: string
  billing_time?: 'calendar' | 'anniversary'
  subscription_at?: string
}

export interface LagoSubscriptionResponse {
  subscription: {
    lago_id: string
    external_id: string
    plan_code: string
    status: string
    started_at: string | null
    current_billing_period_started_at: string | null
    current_billing_period_ending_at: string | null
    canceled_at: string | null
    terminated_at: string | null
  }
}

export interface LagoEventPayload {
  transaction_id: string
  external_subscription_id: string
  code: string
  timestamp?: number
  properties?: Record<string, string | number | boolean>
}

export interface LagoCheckoutUrlResponse {
  customer: {
    checkout_url: string
  }
}

export interface LagoPortalUrlResponse {
  customer: {
    portal_url: string
  }
}

export interface LagoInvoice {
  lago_id: string
  number: string
  issuing_date: string
  payment_status: string
  status: string
  total_amount_cents: number
  currency: string
  file_url: string | null
}

export interface LagoInvoicesResponse {
  invoices: LagoInvoice[]
  meta?: {
    next_page?: number
    current_page?: number
    total_pages?: number
  }
}

export interface LagoWebhookEnvelope {
  webhook_type: string
  object_type: string
  [key: string]: unknown
}

export interface LagoWebhookSubscription {
  lago_id: string
  external_id: string
  external_customer_id: string
  plan_code: string
  status: string
  started_at?: string | null
  current_billing_period_started_at?: string | null
  current_billing_period_ending_at?: string | null
  canceled_at?: string | null
  terminated_at?: string | null
}

export interface LagoWebhookWallet {
  lago_id: string
  external_customer_id: string
  code?: string | null
  status?: string
  credits_balance?: string | number
  balance_cents?: number
}
