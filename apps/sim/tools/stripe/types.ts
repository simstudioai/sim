import type { ToolResponse } from '@/tools/types'

export interface StripeAddress {
  line1?: string
  line2?: string
  city?: string
  state?: string
  postal_code?: string
  country?: string
}

export interface StripeMetadata {
  [key: string]: string
}

// ============================================================================
// Payment Intent Types
// ============================================================================

export interface PaymentIntentObject {
  id: string
  object: 'payment_intent'
  amount: number
  currency: string
  status: string
  customer?: string
  payment_method?: string
  description?: string
  receipt_email?: string
  metadata?: StripeMetadata
  created: number
  [key: string]: any
}

export interface CreatePaymentIntentParams {
  apiKey: string
  amount: number
  currency: string
  customer?: string
  payment_method?: string
  description?: string
  receipt_email?: string
  metadata?: StripeMetadata
  automatic_payment_methods?: { enabled: boolean }
}

export interface RetrievePaymentIntentParams {
  apiKey: string
  id: string
}

export interface UpdatePaymentIntentParams {
  apiKey: string
  id: string
  amount?: number
  currency?: string
  customer?: string
  description?: string
  metadata?: StripeMetadata
}

export interface ConfirmPaymentIntentParams {
  apiKey: string
  id: string
  payment_method?: string
}

export interface CapturePaymentIntentParams {
  apiKey: string
  id: string
  amount_to_capture?: number
}

export interface CancelPaymentIntentParams {
  apiKey: string
  id: string
  cancellation_reason?: string
}

export interface ListPaymentIntentsParams {
  apiKey: string
  limit?: number
  customer?: string
  created?: any
}

export interface SearchPaymentIntentsParams {
  apiKey: string
  query: string
  limit?: number
}

export interface PaymentIntentResponse extends ToolResponse {
  output: {
    payment_intent: PaymentIntentObject
    metadata: {
      id: string
      status: string
      amount: number
      currency: string
    }
  }
}

export interface PaymentIntentListResponse extends ToolResponse {
  output: {
    payment_intents: PaymentIntentObject[]
    metadata: {
      count: number
      has_more: boolean
    }
  }
}

// ============================================================================
// Customer Types
// ============================================================================

export interface CustomerObject {
  id: string
  object: 'customer'
  email?: string
  name?: string
  phone?: string
  description?: string
  address?: StripeAddress
  metadata?: StripeMetadata
  created: number
  [key: string]: any
}

export interface CreateCustomerParams {
  apiKey: string
  email?: string
  name?: string
  phone?: string
  description?: string
  address?: StripeAddress
  metadata?: StripeMetadata
  payment_method?: string
}

export interface RetrieveCustomerParams {
  apiKey: string
  id: string
}

export interface UpdateCustomerParams {
  apiKey: string
  id: string
  email?: string
  name?: string
  phone?: string
  description?: string
  address?: StripeAddress
  metadata?: StripeMetadata
}

export interface DeleteCustomerParams {
  apiKey: string
  id: string
}

export interface ListCustomersParams {
  apiKey: string
  limit?: number
  email?: string
  created?: any
}

export interface SearchCustomersParams {
  apiKey: string
  query: string
  limit?: number
}

export interface CustomerResponse extends ToolResponse {
  output: {
    customer: CustomerObject
    metadata: {
      id: string
      email?: string
      name?: string
    }
  }
}

export interface CustomerListResponse extends ToolResponse {
  output: {
    customers: CustomerObject[]
    metadata: {
      count: number
      has_more: boolean
    }
  }
}

export interface CustomerDeleteResponse extends ToolResponse {
  output: {
    deleted: boolean
    id: string
    metadata: {
      id: string
      deleted: boolean
    }
  }
}

// ============================================================================
// Subscription Types
// ============================================================================

export interface SubscriptionObject {
  id: string
  object: 'subscription'
  customer: string
  status: string
  items: {
    data: Array<{
      id: string
      price: {
        id: string
        [key: string]: any
      }
      [key: string]: any
    }>
  }
  current_period_start: number
  current_period_end: number
  cancel_at_period_end: boolean
  metadata?: StripeMetadata
  created: number
  [key: string]: any
}

export interface CreateSubscriptionParams {
  apiKey: string
  customer: string
  items: Array<{ price: string; quantity?: number }>
  trial_period_days?: number
  default_payment_method?: string
  cancel_at_period_end?: boolean
  metadata?: StripeMetadata
}

export interface RetrieveSubscriptionParams {
  apiKey: string
  id: string
}

export interface UpdateSubscriptionParams {
  apiKey: string
  id: string
  items?: Array<{ price: string; quantity?: number }>
  cancel_at_period_end?: boolean
  metadata?: StripeMetadata
}

export interface CancelSubscriptionParams {
  apiKey: string
  id: string
  prorate?: boolean
  invoice_now?: boolean
}

export interface ResumeSubscriptionParams {
  apiKey: string
  id: string
}

export interface ListSubscriptionsParams {
  apiKey: string
  limit?: number
  customer?: string
  status?: string
  price?: string
}

export interface SearchSubscriptionsParams {
  apiKey: string
  query: string
  limit?: number
}

export interface SubscriptionResponse extends ToolResponse {
  output: {
    subscription: SubscriptionObject
    metadata: {
      id: string
      status: string
      customer: string
    }
  }
}

export interface SubscriptionListResponse extends ToolResponse {
  output: {
    subscriptions: SubscriptionObject[]
    metadata: {
      count: number
      has_more: boolean
    }
  }
}

// ============================================================================
// Invoice Types
// ============================================================================

export interface InvoiceObject {
  id: string
  object: 'invoice'
  customer: string
  amount_due: number
  amount_paid: number
  amount_remaining: number
  currency: string
  status: string
  description?: string
  metadata?: StripeMetadata
  created: number
  [key: string]: any
}

export interface CreateInvoiceParams {
  apiKey: string
  customer: string
  description?: string
  metadata?: StripeMetadata
  auto_advance?: boolean
  collection_method?: 'charge_automatically' | 'send_invoice'
}

export interface RetrieveInvoiceParams {
  apiKey: string
  id: string
}

export interface UpdateInvoiceParams {
  apiKey: string
  id: string
  description?: string
  metadata?: StripeMetadata
  auto_advance?: boolean
}

export interface DeleteInvoiceParams {
  apiKey: string
  id: string
}

export interface FinalizeInvoiceParams {
  apiKey: string
  id: string
  auto_advance?: boolean
}

export interface PayInvoiceParams {
  apiKey: string
  id: string
  paid_out_of_band?: boolean
}

export interface VoidInvoiceParams {
  apiKey: string
  id: string
}

export interface SendInvoiceParams {
  apiKey: string
  id: string
}

export interface ListInvoicesParams {
  apiKey: string
  limit?: number
  customer?: string
  status?: string
}

export interface SearchInvoicesParams {
  apiKey: string
  query: string
  limit?: number
}

export interface InvoiceResponse extends ToolResponse {
  output: {
    invoice: InvoiceObject
    metadata: {
      id: string
      status: string
      amount_due: number
      currency: string
    }
  }
}

export interface InvoiceListResponse extends ToolResponse {
  output: {
    invoices: InvoiceObject[]
    metadata: {
      count: number
      has_more: boolean
    }
  }
}

export interface InvoiceDeleteResponse extends ToolResponse {
  output: {
    deleted: boolean
    id: string
    metadata: {
      id: string
      deleted: boolean
    }
  }
}

// ============================================================================
// Charge Types
// ============================================================================

export interface ChargeObject {
  id: string
  object: 'charge'
  amount: number
  currency: string
  status: string
  customer?: string
  description?: string
  paid: boolean
  refunded: boolean
  metadata?: StripeMetadata
  created: number
  [key: string]: any
}

export interface CreateChargeParams {
  apiKey: string
  amount: number
  currency: string
  customer?: string
  source?: string
  description?: string
  metadata?: StripeMetadata
  capture?: boolean
}

export interface RetrieveChargeParams {
  apiKey: string
  id: string
}

export interface UpdateChargeParams {
  apiKey: string
  id: string
  description?: string
  metadata?: StripeMetadata
}

export interface CaptureChargeParams {
  apiKey: string
  id: string
  amount?: number
}

export interface ListChargesParams {
  apiKey: string
  limit?: number
  customer?: string
  created?: any
}

export interface SearchChargesParams {
  apiKey: string
  query: string
  limit?: number
}

export interface ChargeResponse extends ToolResponse {
  output: {
    charge: ChargeObject
    metadata: {
      id: string
      status: string
      amount: number
      currency: string
      paid: boolean
    }
  }
}

export interface ChargeListResponse extends ToolResponse {
  output: {
    charges: ChargeObject[]
    metadata: {
      count: number
      has_more: boolean
    }
  }
}

// ============================================================================
// Product Types
// ============================================================================

export interface ProductObject {
  id: string
  object: 'product'
  name: string
  description?: string
  active: boolean
  images?: string[]
  metadata?: StripeMetadata
  created: number
  [key: string]: any
}

export interface CreateProductParams {
  apiKey: string
  name: string
  description?: string
  active?: boolean
  images?: string[]
  metadata?: StripeMetadata
}

export interface RetrieveProductParams {
  apiKey: string
  id: string
}

export interface UpdateProductParams {
  apiKey: string
  id: string
  name?: string
  description?: string
  active?: boolean
  images?: string[]
  metadata?: StripeMetadata
}

export interface DeleteProductParams {
  apiKey: string
  id: string
}

export interface ListProductsParams {
  apiKey: string
  limit?: number
  active?: boolean
}

export interface SearchProductsParams {
  apiKey: string
  query: string
  limit?: number
}

export interface ProductResponse extends ToolResponse {
  output: {
    product: ProductObject
    metadata: {
      id: string
      name: string
      active: boolean
    }
  }
}

export interface ProductListResponse extends ToolResponse {
  output: {
    products: ProductObject[]
    metadata: {
      count: number
      has_more: boolean
    }
  }
}

export interface ProductDeleteResponse extends ToolResponse {
  output: {
    deleted: boolean
    id: string
    metadata: {
      id: string
      deleted: boolean
    }
  }
}

// ============================================================================
// Price Types
// ============================================================================

export interface PriceObject {
  id: string
  object: 'price'
  product: string
  unit_amount?: number
  currency: string
  recurring?: {
    interval: string
    interval_count: number
  }
  metadata?: StripeMetadata
  active: boolean
  created: number
  [key: string]: any
}

export interface CreatePriceParams {
  apiKey: string
  product: string
  currency: string
  unit_amount?: number
  recurring?: {
    interval: 'day' | 'week' | 'month' | 'year'
    interval_count?: number
  }
  metadata?: StripeMetadata
  billing_scheme?: 'per_unit' | 'tiered'
}

export interface RetrievePriceParams {
  apiKey: string
  id: string
}

export interface UpdatePriceParams {
  apiKey: string
  id: string
  active?: boolean
  metadata?: StripeMetadata
}

export interface ListPricesParams {
  apiKey: string
  limit?: number
  product?: string
  active?: boolean
}

export interface SearchPricesParams {
  apiKey: string
  query: string
  limit?: number
}

export interface PriceResponse extends ToolResponse {
  output: {
    price: PriceObject
    metadata: {
      id: string
      product: string
      unit_amount?: number
      currency: string
    }
  }
}

export interface PriceListResponse extends ToolResponse {
  output: {
    prices: PriceObject[]
    metadata: {
      count: number
      has_more: boolean
    }
  }
}

// ============================================================================
// Event Types
// ============================================================================

export interface EventObject {
  id: string
  object: 'event'
  type: string
  data: {
    object: any
  }
  created: number
  livemode: boolean
  api_version?: string
  request?: {
    id: string
    idempotency_key?: string
  }
  [key: string]: any
}

export interface RetrieveEventParams {
  apiKey: string
  id: string
}

export interface ListEventsParams {
  apiKey: string
  limit?: number
  type?: string
  created?: any
}

export interface EventResponse extends ToolResponse {
  output: {
    event: EventObject
    metadata: {
      id: string
      type: string
      created: number
    }
  }
}

export interface EventListResponse extends ToolResponse {
  output: {
    events: EventObject[]
    metadata: {
      count: number
      has_more: boolean
    }
  }
}

export type StripeResponse =
  | PaymentIntentResponse
  | PaymentIntentListResponse
  | CustomerResponse
  | CustomerListResponse
  | CustomerDeleteResponse
  | SubscriptionResponse
  | SubscriptionListResponse
  | InvoiceResponse
  | InvoiceListResponse
  | InvoiceDeleteResponse
  | ChargeResponse
  | ChargeListResponse
  | ProductResponse
  | ProductListResponse
  | ProductDeleteResponse
  | PriceResponse
  | PriceListResponse
  | EventResponse
  | EventListResponse
