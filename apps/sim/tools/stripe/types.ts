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

// ============================================================================
// Advanced Stripe Tools - Payout Reconciliation
// ============================================================================

export interface ReconcilePayoutsParams {
  apiKey: string
  startDate: string
  endDate: string
  bankTransactions: any[]
  amountTolerance?: number
  dateTolerance?: number
}

export interface ReconcilePayoutsResponse extends ToolResponse {
  output: {
    matched_payouts: Array<{
      payout_id: string
      payout_amount: number
      payout_date: string
      payout_status: string
      bank_transaction_id: string
      bank_amount: number
      bank_date: string
      bank_name: string
      confidence: number
      status: string
    }>
    unmatched_payouts: Array<{
      payout_id: string
      payout_amount: number
      payout_date: string
      payout_status: string
      arrival_date: string | null
      status: string
      reason: string
    }>
    metadata: {
      total_payouts: number
      matched_count: number
      unmatched_count: number
      match_rate: number
      date_range: {
        start: string
        end: string
      }
    }
  }
}

// ============================================================================
// Advanced Stripe Tools - Tax Reporting
// ============================================================================

export interface GenerateTaxReportParams {
  apiKey: string
  taxYear: number
  reportType?: string
}

export interface GenerateTaxReportResponse extends ToolResponse {
  output: {
    tax_summary: {
      tax_year: number
      total_gross_payments: number
      total_refunds: number
      total_net_payments: number
      total_transactions: number
      requires_1099k: boolean
      threshold_amount: number
      filing_deadline: string
    }
    monthly_breakdown: Array<{
      month: number
      month_name: string
      gross_payments: number
      refunds: number
      net_payments: number
      transaction_count: number
    }>
    payment_method_breakdown: Array<{
      payment_type: string
      total_amount: number
      percentage: number
    }>
    metadata: {
      tax_year: number
      report_type: string
      requires_1099k: boolean
      total_gross_payments: number
      total_net_payments: number
    }
  }
}

// ============================================================================
// Advanced Stripe Tools - Revenue Analytics
// ============================================================================

export interface AnalyzeRevenueParams {
  apiKey: string
  startDate: string
  endDate: string
  includeSubscriptions?: boolean
  compareToPreviousPeriod?: boolean
}

export interface AnalyzeRevenueResponse extends ToolResponse {
  output: {
    revenue_summary: {
      total_revenue: number
      total_transactions: number
      unique_customers: number
      avg_transaction_value: number
      avg_revenue_per_customer: number
      period_days: number
      avg_daily_revenue: number
    }
    recurring_metrics: {
      estimated_mrr: number
      estimated_arr: number
      note: string
    }
    top_customers: Array<{
      customer_id: string
      total_revenue: number
      percentage_of_total: number
    }>
    revenue_trend: Array<{
      date: string
      revenue: number
    }>
    metadata: {
      start_date: string
      end_date: string
      total_revenue: number
      growth_rate: number | null
    }
  }
}

// ============================================================================
// Advanced Stripe Tools - Failed Payments
// ============================================================================

export interface DetectFailedPaymentsParams {
  apiKey: string
  startDate: string
  endDate: string
  minimumAmount?: number
}

export interface DetectFailedPaymentsResponse extends ToolResponse {
  output: {
    failed_payments: Array<{
      charge_id: string
      customer_id: string
      amount: number
      currency: string
      failure_code: string
      failure_message: string
      created: string
      payment_method: string
      description: string | null
      receipt_email: string | null
    }>
    failure_summary: {
      total_failures: number
      total_failed_amount: number
      unique_customers_affected: number
      avg_failed_amount: number
    }
    failure_categories: {
      insufficient_funds: number
      card_declined: number
      expired_card: number
      incorrect_cvc: number
      processing_error: number
      fraud_suspected: number
      other: number
    }
    failure_reasons: Array<{
      failure_code: string
      count: number
      percentage: number
    }>
    high_risk_customers: Array<{
      customer_id: string
      failure_count: number
      risk_level: string
      recommended_action: string
    }>
    recovery_recommendations: string[]
    metadata: {
      start_date: string
      end_date: string
      total_failures: number
      total_failed_amount: number
    }
  }
}

// ============================================================================
// Advanced Stripe Tools - Recurring Invoices
// ============================================================================

export interface CreateRecurringInvoiceParams {
  apiKey: string
  customer: string
  amount: number
  currency?: string
  interval: string
  intervalCount?: number
  description?: string
  autoAdvance?: boolean
  daysUntilDue?: number
}

export interface CreateRecurringInvoiceResponse extends ToolResponse {
  output: {
    invoice: {
      id: string
      customer: string
      amount_due: number
      currency: string
      status: string
      created: string
      due_date: string | null
      invoice_pdf: string | null
      hosted_invoice_url: string | null
    }
    recurring_schedule: {
      interval: string
      interval_count: number
      next_invoice_date: string
      estimated_annual_value: number
    }
    metadata: {
      invoice_id: string
      customer_id: string
      amount: number
      status: string
      recurring: boolean
      interval: string
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
  | ReconcilePayoutsResponse
  | GenerateTaxReportResponse
  | AnalyzeRevenueResponse
  | DetectFailedPaymentsResponse
  | CreateRecurringInvoiceResponse
