import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Stripe API responses.
 * These are reusable across all Stripe tools to ensure consistency.
 * Based on official Stripe API documentation: https://docs.stripe.com/api
 */

/**
 * Output definition for Stripe address objects
 * @see https://docs.stripe.com/api/customers/object#customer_object-address
 */
export const ADDRESS_OUTPUT_PROPERTIES = {
  line1: { type: 'string', description: 'Address line 1 (street address)', optional: true },
  line2: { type: 'string', description: 'Address line 2 (apartment, suite, etc.)', optional: true },
  city: { type: 'string', description: 'City name', optional: true },
  state: { type: 'string', description: 'State, county, province, or region', optional: true },
  postal_code: { type: 'string', description: 'ZIP or postal code', optional: true },
  country: {
    type: 'string',
    description: 'Two-letter country code (ISO 3166-1 alpha-2)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete address object output definition
 */
export const ADDRESS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Address object',
  optional: true,
  properties: ADDRESS_OUTPUT_PROPERTIES,
}

/**
 * Output definition for Stripe shipping objects
 * @see https://docs.stripe.com/api/customers/object#customer_object-shipping
 */
export const SHIPPING_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Recipient name', optional: true },
  phone: { type: 'string', description: 'Recipient phone number', optional: true },
  address: ADDRESS_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Complete shipping object output definition
 */
export const SHIPPING_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Shipping information',
  optional: true,
  properties: SHIPPING_OUTPUT_PROPERTIES,
}

/**
 * Output definition for Customer objects
 * @see https://docs.stripe.com/api/customers/object
 */
export const CUSTOMER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the customer' },
  object: { type: 'string', description: 'String representing the object type (customer)' },
  address: ADDRESS_OUTPUT,
  balance: {
    type: 'number',
    description: 'Current balance in smallest currency unit',
    optional: true,
  },
  created: { type: 'number', description: 'Unix timestamp when the customer was created' },
  currency: {
    type: 'string',
    description: 'Three-letter ISO currency code (lowercase)',
    optional: true,
  },
  default_source: {
    type: 'string',
    description: 'ID of the default payment source',
    optional: true,
  },
  delinquent: {
    type: 'boolean',
    description: 'Whether the customer has unpaid invoices',
    optional: true,
  },
  description: { type: 'string', description: 'Description of the customer', optional: true },
  discount: {
    type: 'json',
    description: 'Discount that applies to all recurring charges',
    optional: true,
  },
  email: {
    type: 'string',
    description: 'Customer email address (max 512 characters)',
    optional: true,
  },
  invoice_prefix: {
    type: 'string',
    description: 'Prefix for generating unique invoice numbers',
    optional: true,
  },
  invoice_settings: { type: 'json', description: 'Default invoice settings', optional: true },
  livemode: { type: 'boolean', description: 'Whether object exists in live mode or test mode' },
  metadata: {
    type: 'json',
    description: 'Set of key-value pairs for storing additional information',
  },
  name: {
    type: 'string',
    description: 'Customer full name or business name (max 256 characters)',
    optional: true,
  },
  next_invoice_sequence: {
    type: 'number',
    description: 'Next invoice sequence number',
    optional: true,
  },
  phone: {
    type: 'string',
    description: 'Customer phone number (max 20 characters)',
    optional: true,
  },
  preferred_locales: {
    type: 'array',
    description: 'Customer preferred locales',
    optional: true,
    items: { type: 'string' },
  },
  shipping: SHIPPING_OUTPUT,
  tax_exempt: {
    type: 'string',
    description: 'Tax exemption status (none, exempt, reverse)',
    optional: true,
  },
  test_clock: { type: 'string', description: 'ID of the test clock', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete customer object output definition
 */
export const CUSTOMER_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Stripe Customer object',
  properties: CUSTOMER_OUTPUT_PROPERTIES,
}

/**
 * Output definition for Customer metadata (summary)
 */
export const CUSTOMER_METADATA_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Stripe unique identifier' },
  email: { type: 'string', description: 'Customer email address', optional: true },
  name: { type: 'string', description: 'Display name', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for Payment Intent objects
 * @see https://docs.stripe.com/api/payment_intents/object
 */
export const PAYMENT_INTENT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the Payment Intent' },
  object: { type: 'string', description: 'String representing the object type (payment_intent)' },
  amount: {
    type: 'number',
    description: 'Amount intended to be collected in smallest currency unit',
  },
  amount_capturable: { type: 'number', description: 'Amount that can be captured', optional: true },
  amount_received: { type: 'number', description: 'Amount that was collected', optional: true },
  application: {
    type: 'string',
    description: 'ID of the Connect application that created the PaymentIntent',
    optional: true,
  },
  application_fee_amount: {
    type: 'number',
    description: 'Application fee amount (if any)',
    optional: true,
  },
  automatic_payment_methods: {
    type: 'json',
    description: 'Settings for automatic payment methods',
    optional: true,
  },
  canceled_at: { type: 'number', description: 'Unix timestamp of cancellation', optional: true },
  cancellation_reason: { type: 'string', description: 'Reason for cancellation', optional: true },
  capture_method: {
    type: 'string',
    description: 'Controls when funds will be captured (automatic or manual)',
  },
  client_secret: {
    type: 'string',
    description: 'Client secret for confirming the PaymentIntent',
    optional: true,
  },
  confirmation_method: {
    type: 'string',
    description: 'How the PaymentIntent can be confirmed (automatic or manual)',
  },
  created: { type: 'number', description: 'Unix timestamp when the PaymentIntent was created' },
  currency: { type: 'string', description: 'Three-letter ISO currency code (lowercase)' },
  customer: {
    type: 'string',
    description: 'ID of the Customer this PaymentIntent belongs to',
    optional: true,
  },
  description: { type: 'string', description: 'Description of the payment', optional: true },
  invoice: {
    type: 'string',
    description: 'ID of the invoice that created this PaymentIntent',
    optional: true,
  },
  last_payment_error: {
    type: 'json',
    description: 'The payment error encountered in the previous PaymentIntent confirmation',
    optional: true,
  },
  latest_charge: {
    type: 'string',
    description: 'ID of the latest charge created by this PaymentIntent',
    optional: true,
  },
  livemode: { type: 'boolean', description: 'Whether object exists in live mode or test mode' },
  metadata: {
    type: 'json',
    description: 'Set of key-value pairs for storing additional information',
  },
  next_action: {
    type: 'json',
    description: 'Actions required before the PaymentIntent can be confirmed',
    optional: true,
  },
  on_behalf_of: {
    type: 'string',
    description: 'The account on behalf of which to charge',
    optional: true,
  },
  payment_method: { type: 'string', description: 'ID of the payment method used', optional: true },
  payment_method_options: {
    type: 'json',
    description: 'Payment-method-specific configuration',
    optional: true,
  },
  payment_method_types: {
    type: 'array',
    description: 'Payment method types that can be used',
    items: { type: 'string' },
  },
  processing: {
    type: 'json',
    description: 'Processing status if payment is being processed asynchronously',
    optional: true,
  },
  receipt_email: {
    type: 'string',
    description: 'Email address to send the receipt to',
    optional: true,
  },
  review: {
    type: 'string',
    description: 'ID of the review associated with this PaymentIntent',
    optional: true,
  },
  setup_future_usage: {
    type: 'string',
    description: 'Indicates intent to make future payments',
    optional: true,
  },
  shipping: SHIPPING_OUTPUT,
  statement_descriptor: {
    type: 'string',
    description: 'Statement descriptor for charges',
    optional: true,
  },
  statement_descriptor_suffix: {
    type: 'string',
    description: 'Statement descriptor suffix',
    optional: true,
  },
  status: {
    type: 'string',
    description:
      'Status of the PaymentIntent (requires_payment_method, requires_confirmation, requires_action, processing, requires_capture, canceled, succeeded)',
  },
  transfer_data: {
    type: 'json',
    description: 'The data for creating a transfer after the payment succeeds',
    optional: true,
  },
  transfer_group: {
    type: 'string',
    description: 'Transfer group for transfers associated with the payment',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete Payment Intent object output definition
 */
export const PAYMENT_INTENT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Stripe Payment Intent object',
  properties: PAYMENT_INTENT_OUTPUT_PROPERTIES,
}

/**
 * Output definition for Payment Intent metadata (summary)
 */
export const PAYMENT_INTENT_METADATA_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Stripe unique identifier' },
  status: { type: 'string', description: 'Current state of the resource' },
  amount: { type: 'number', description: 'Amount in smallest currency unit (e.g., cents)' },
  currency: { type: 'string', description: 'Three-letter ISO currency code (lowercase)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for Subscription Item objects
 * @see https://docs.stripe.com/api/subscription_items/object
 */
export const SUBSCRIPTION_ITEM_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the subscription item' },
  object: {
    type: 'string',
    description: 'String representing the object type (subscription_item)',
  },
  billing_thresholds: {
    type: 'json',
    description: 'Billing thresholds for the subscription item',
    optional: true,
  },
  created: { type: 'number', description: 'Unix timestamp when the item was added' },
  metadata: {
    type: 'json',
    description: 'Set of key-value pairs for storing additional information',
  },
  price: { type: 'json', description: 'Price object for this subscription item' },
  quantity: { type: 'number', description: 'Quantity of the plan to subscribe to', optional: true },
  subscription: { type: 'string', description: 'ID of the subscription this item belongs to' },
  tax_rates: {
    type: 'array',
    description: 'Tax rates applied to this subscription item',
    optional: true,
    items: { type: 'object' },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for Subscription objects
 * @see https://docs.stripe.com/api/subscriptions/object
 */
export const SUBSCRIPTION_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the subscription' },
  object: { type: 'string', description: 'String representing the object type (subscription)' },
  application: {
    type: 'string',
    description: 'ID of the Connect application that created the subscription',
    optional: true,
  },
  application_fee_percent: {
    type: 'number',
    description: 'Application fee percent (if any)',
    optional: true,
  },
  automatic_tax: { type: 'json', description: 'Automatic tax settings', optional: true },
  billing_cycle_anchor: {
    type: 'number',
    description: 'Unix timestamp determining when billing cycle starts',
  },
  billing_thresholds: {
    type: 'json',
    description: 'Billing thresholds for the subscription',
    optional: true,
  },
  cancel_at: {
    type: 'number',
    description: 'Unix timestamp when the subscription will be canceled',
    optional: true,
  },
  cancel_at_period_end: {
    type: 'boolean',
    description: 'Whether the subscription will be canceled at period end',
  },
  canceled_at: {
    type: 'number',
    description: 'Unix timestamp when the subscription was canceled',
    optional: true,
  },
  cancellation_details: { type: 'json', description: 'Details about cancellation', optional: true },
  collection_method: {
    type: 'string',
    description: 'Collection method (charge_automatically or send_invoice)',
  },
  created: { type: 'number', description: 'Unix timestamp when the subscription was created' },
  currency: { type: 'string', description: 'Three-letter ISO currency code (lowercase)' },
  current_period_end: {
    type: 'number',
    description: 'Unix timestamp when the current period ends',
  },
  current_period_start: {
    type: 'number',
    description: 'Unix timestamp when the current period started',
  },
  customer: { type: 'string', description: 'ID of the customer who owns the subscription' },
  days_until_due: {
    type: 'number',
    description: 'Number of days a customer has to pay invoices',
    optional: true,
  },
  default_payment_method: {
    type: 'string',
    description: 'ID of the default payment method',
    optional: true,
  },
  default_source: { type: 'string', description: 'ID of the default source', optional: true },
  default_tax_rates: {
    type: 'array',
    description: 'Default tax rates',
    optional: true,
    items: { type: 'object' },
  },
  description: {
    type: 'string',
    description: 'Subscription description (max 500 characters)',
    optional: true,
  },
  discount: {
    type: 'json',
    description: 'Discount that applies to the subscription',
    optional: true,
  },
  ended_at: {
    type: 'number',
    description: 'Unix timestamp when the subscription ended',
    optional: true,
  },
  items: {
    type: 'object',
    description: 'List of subscription items',
    properties: {
      object: { type: 'string', description: 'String representing the object type (list)' },
      data: {
        type: 'array',
        description: 'Array of subscription items',
        items: { type: 'object', properties: SUBSCRIPTION_ITEM_OUTPUT_PROPERTIES },
      },
      has_more: { type: 'boolean', description: 'Whether there are more items' },
      url: { type: 'string', description: 'URL to fetch more items' },
    },
  },
  latest_invoice: { type: 'string', description: 'ID of the most recent invoice', optional: true },
  livemode: { type: 'boolean', description: 'Whether object exists in live mode or test mode' },
  metadata: {
    type: 'json',
    description: 'Set of key-value pairs for storing additional information',
  },
  next_pending_invoice_item_invoice: {
    type: 'number',
    description: 'Unix timestamp of next pending invoice item invoice',
    optional: true,
  },
  on_behalf_of: {
    type: 'string',
    description: 'Account the subscription is made on behalf of',
    optional: true,
  },
  pause_collection: {
    type: 'json',
    description: 'If paused, when collection is paused until',
    optional: true,
  },
  payment_settings: {
    type: 'json',
    description: 'Payment settings for the subscription',
    optional: true,
  },
  pending_invoice_item_interval: {
    type: 'json',
    description: 'Pending invoice item interval',
    optional: true,
  },
  pending_setup_intent: {
    type: 'string',
    description: 'ID of the pending SetupIntent',
    optional: true,
  },
  pending_update: { type: 'json', description: 'Pending subscription update', optional: true },
  schedule: { type: 'string', description: 'ID of the subscription schedule', optional: true },
  start_date: { type: 'number', description: 'Unix timestamp when the subscription started' },
  status: {
    type: 'string',
    description:
      'Status of the subscription (incomplete, incomplete_expired, trialing, active, past_due, canceled, unpaid, paused)',
  },
  test_clock: { type: 'string', description: 'ID of the test clock', optional: true },
  transfer_data: {
    type: 'json',
    description: 'Data for creating transfers after payments succeed',
    optional: true,
  },
  trial_end: { type: 'number', description: 'Unix timestamp when the trial ends', optional: true },
  trial_settings: {
    type: 'json',
    description: 'Settings related to subscription trials',
    optional: true,
  },
  trial_start: {
    type: 'number',
    description: 'Unix timestamp when the trial started',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete Subscription object output definition
 */
export const SUBSCRIPTION_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Stripe Subscription object',
  properties: SUBSCRIPTION_OUTPUT_PROPERTIES,
}

/**
 * Output definition for Subscription metadata (summary)
 */
export const SUBSCRIPTION_METADATA_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Stripe unique identifier' },
  status: { type: 'string', description: 'Current state of the resource' },
  customer: { type: 'string', description: 'Associated customer ID' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for Invoice Line Item objects
 * @see https://docs.stripe.com/api/invoice-line-item/object
 */
export const INVOICE_LINE_ITEM_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the line item' },
  object: { type: 'string', description: 'String representing the object type (line_item)' },
  amount: { type: 'number', description: 'Amount in smallest currency unit' },
  amount_excluding_tax: { type: 'number', description: 'Amount excluding tax', optional: true },
  currency: { type: 'string', description: 'Three-letter ISO currency code (lowercase)' },
  description: { type: 'string', description: 'Description of the line item', optional: true },
  discount_amounts: {
    type: 'array',
    description: 'Discount amounts applied',
    optional: true,
    items: { type: 'object' },
  },
  discountable: { type: 'boolean', description: 'Whether the line item is discountable' },
  discounts: {
    type: 'array',
    description: 'Discounts applied to the line item',
    optional: true,
    items: { type: 'string' },
  },
  invoice: {
    type: 'string',
    description: 'ID of the invoice that contains this line item',
    optional: true,
  },
  livemode: { type: 'boolean', description: 'Whether object exists in live mode or test mode' },
  metadata: {
    type: 'json',
    description: 'Set of key-value pairs for storing additional information',
  },
  period: { type: 'json', description: 'Period this line item covers' },
  price: { type: 'json', description: 'Price object for this line item', optional: true },
  proration: { type: 'boolean', description: 'Whether this is a proration' },
  proration_details: {
    type: 'json',
    description: 'Additional details for proration line items',
    optional: true,
  },
  quantity: { type: 'number', description: 'Quantity of the item', optional: true },
  subscription: { type: 'string', description: 'ID of the subscription', optional: true },
  subscription_item: { type: 'string', description: 'ID of the subscription item', optional: true },
  tax_amounts: {
    type: 'array',
    description: 'Tax amounts for this line item',
    optional: true,
    items: { type: 'object' },
  },
  tax_rates: {
    type: 'array',
    description: 'Tax rates applied',
    optional: true,
    items: { type: 'object' },
  },
  type: { type: 'string', description: 'Type of line item (invoiceitem or subscription)' },
  unit_amount_excluding_tax: {
    type: 'string',
    description: 'Unit amount excluding tax',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for Invoice objects
 * @see https://docs.stripe.com/api/invoices/object
 */
export const INVOICE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the invoice' },
  object: { type: 'string', description: 'String representing the object type (invoice)' },
  account_country: {
    type: 'string',
    description: 'Country of the business associated with this invoice',
    optional: true,
  },
  account_name: {
    type: 'string',
    description: 'Name of the account associated with this invoice',
    optional: true,
  },
  account_tax_ids: {
    type: 'array',
    description: 'Account tax IDs',
    optional: true,
    items: { type: 'string' },
  },
  amount_due: { type: 'number', description: 'Final amount due in smallest currency unit' },
  amount_paid: { type: 'number', description: 'Amount paid in smallest currency unit' },
  amount_remaining: { type: 'number', description: 'Amount remaining in smallest currency unit' },
  amount_shipping: {
    type: 'number',
    description: 'Shipping amount in smallest currency unit',
    optional: true,
  },
  application: {
    type: 'string',
    description: 'ID of the Connect application that created the invoice',
    optional: true,
  },
  application_fee_amount: { type: 'number', description: 'Application fee amount', optional: true },
  attempt_count: { type: 'number', description: 'Number of payment attempts made' },
  attempted: {
    type: 'boolean',
    description: 'Whether an attempt has been made to pay the invoice',
  },
  auto_advance: {
    type: 'boolean',
    description: 'Controls whether Stripe performs automatic collection',
  },
  automatic_tax: {
    type: 'json',
    description: 'Settings and results for automatic tax lookup',
    optional: true,
  },
  billing_reason: { type: 'string', description: 'Reason the invoice was created', optional: true },
  charge: {
    type: 'string',
    description: 'ID of the latest charge for this invoice',
    optional: true,
  },
  collection_method: {
    type: 'string',
    description: 'Collection method (charge_automatically or send_invoice)',
  },
  created: { type: 'number', description: 'Unix timestamp when the invoice was created' },
  currency: { type: 'string', description: 'Three-letter ISO currency code (lowercase)' },
  custom_fields: {
    type: 'array',
    description: 'Custom fields displayed on the invoice',
    optional: true,
    items: { type: 'object' },
  },
  customer: { type: 'string', description: 'ID of the customer who will be billed' },
  customer_address: ADDRESS_OUTPUT,
  customer_email: { type: 'string', description: 'Email of the customer', optional: true },
  customer_name: { type: 'string', description: 'Name of the customer', optional: true },
  customer_phone: { type: 'string', description: 'Phone number of the customer', optional: true },
  customer_shipping: SHIPPING_OUTPUT,
  customer_tax_exempt: {
    type: 'string',
    description: 'Tax exemption status of the customer',
    optional: true,
  },
  customer_tax_ids: {
    type: 'array',
    description: 'Customer tax IDs',
    optional: true,
    items: { type: 'object' },
  },
  default_payment_method: {
    type: 'string',
    description: 'ID of the default payment method',
    optional: true,
  },
  default_source: { type: 'string', description: 'ID of the default source', optional: true },
  default_tax_rates: {
    type: 'array',
    description: 'Default tax rates',
    optional: true,
    items: { type: 'object' },
  },
  description: {
    type: 'string',
    description: 'Description displayed in Dashboard (memo)',
    optional: true,
  },
  discount: { type: 'json', description: 'Discount applied to the invoice', optional: true },
  discounts: {
    type: 'array',
    description: 'Discounts applied to the invoice',
    optional: true,
    items: { type: 'string' },
  },
  due_date: { type: 'number', description: 'Unix timestamp when payment is due', optional: true },
  effective_at: { type: 'number', description: 'When the invoice was effective', optional: true },
  ending_balance: {
    type: 'number',
    description: 'Ending customer balance after invoice is finalized',
    optional: true,
  },
  footer: { type: 'string', description: 'Footer displayed on the invoice', optional: true },
  from_invoice: {
    type: 'json',
    description: 'Details of the invoice that this invoice was created from',
    optional: true,
  },
  hosted_invoice_url: {
    type: 'string',
    description: 'URL for the hosted invoice page',
    optional: true,
  },
  invoice_pdf: { type: 'string', description: 'URL for the invoice PDF', optional: true },
  issuer: {
    type: 'json',
    description: 'The connected account that issues the invoice',
    optional: true,
  },
  last_finalization_error: {
    type: 'json',
    description: 'Error encountered during finalization',
    optional: true,
  },
  latest_revision: {
    type: 'string',
    description: 'ID of the most recent revision',
    optional: true,
  },
  lines: {
    type: 'object',
    description: 'Invoice line items',
    properties: {
      object: { type: 'string', description: 'String representing the object type (list)' },
      data: {
        type: 'array',
        description: 'Array of line items',
        items: { type: 'object', properties: INVOICE_LINE_ITEM_OUTPUT_PROPERTIES },
      },
      has_more: { type: 'boolean', description: 'Whether there are more items' },
      url: { type: 'string', description: 'URL to fetch more items' },
    },
  },
  livemode: { type: 'boolean', description: 'Whether object exists in live mode or test mode' },
  metadata: {
    type: 'json',
    description: 'Set of key-value pairs for storing additional information',
  },
  next_payment_attempt: {
    type: 'number',
    description: 'Unix timestamp of next payment attempt',
    optional: true,
  },
  number: { type: 'string', description: 'Human-readable invoice number', optional: true },
  on_behalf_of: {
    type: 'string',
    description: 'Account on behalf of which the invoice was issued',
    optional: true,
  },
  paid: { type: 'boolean', description: 'Whether payment was successfully collected' },
  paid_out_of_band: { type: 'boolean', description: 'Whether the invoice was paid out of band' },
  payment_intent: {
    type: 'string',
    description: 'ID of the PaymentIntent associated with the invoice',
    optional: true,
  },
  payment_settings: {
    type: 'json',
    description: 'Configuration settings for payment collection',
    optional: true,
  },
  period_end: { type: 'number', description: 'End of the usage period' },
  period_start: { type: 'number', description: 'Start of the usage period' },
  post_payment_credit_notes_amount: {
    type: 'number',
    description: 'Total of all post-payment credit notes',
    optional: true,
  },
  pre_payment_credit_notes_amount: {
    type: 'number',
    description: 'Total of all pre-payment credit notes',
    optional: true,
  },
  quote: {
    type: 'string',
    description: 'ID of the quote this invoice was generated from',
    optional: true,
  },
  receipt_number: { type: 'string', description: 'Receipt number for the invoice', optional: true },
  rendering: { type: 'json', description: 'Invoice rendering options', optional: true },
  rendering_options: {
    type: 'json',
    description: 'Invoice rendering options (deprecated)',
    optional: true,
  },
  shipping_cost: { type: 'json', description: 'Shipping cost information', optional: true },
  shipping_details: SHIPPING_OUTPUT,
  starting_balance: { type: 'number', description: 'Starting customer balance before invoice' },
  statement_descriptor: { type: 'string', description: 'Statement descriptor', optional: true },
  status: {
    type: 'string',
    description: 'Status of the invoice (draft, open, paid, uncollectible, void)',
  },
  status_transitions: {
    type: 'json',
    description: 'Timestamps at which the invoice status was updated',
    optional: true,
  },
  subscription: {
    type: 'string',
    description: 'ID of the subscription for this invoice',
    optional: true,
  },
  subscription_details: {
    type: 'json',
    description: 'Details about the subscription',
    optional: true,
  },
  subscription_proration_date: {
    type: 'number',
    description: 'Only set for upcoming invoices with proration',
    optional: true,
  },
  subtotal: { type: 'number', description: 'Total before discounts and taxes' },
  subtotal_excluding_tax: { type: 'number', description: 'Subtotal excluding tax', optional: true },
  tax: { type: 'number', description: 'Total tax amount', optional: true },
  test_clock: { type: 'string', description: 'ID of the test clock', optional: true },
  threshold_reason: {
    type: 'json',
    description: 'Details about why the invoice was created',
    optional: true,
  },
  total: { type: 'number', description: 'Total after discounts and taxes' },
  total_discount_amounts: {
    type: 'array',
    description: 'Total discount amounts',
    optional: true,
    items: { type: 'object' },
  },
  total_excluding_tax: { type: 'number', description: 'Total excluding tax', optional: true },
  total_tax_amounts: {
    type: 'array',
    description: 'Total tax amounts',
    optional: true,
    items: { type: 'object' },
  },
  transfer_data: { type: 'json', description: 'Data for creating transfers', optional: true },
  webhooks_delivered_at: {
    type: 'number',
    description: 'Unix timestamp of webhooks delivery',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete Invoice object output definition
 */
export const INVOICE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Stripe Invoice object',
  properties: INVOICE_OUTPUT_PROPERTIES,
}

/**
 * Output definition for Invoice metadata (summary)
 */
export const INVOICE_METADATA_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Stripe unique identifier' },
  status: { type: 'string', description: 'Current state of the resource' },
  amount_due: {
    type: 'number',
    description: 'Amount remaining to be paid in smallest currency unit',
  },
  currency: { type: 'string', description: 'Three-letter ISO currency code (lowercase)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for Charge objects
 * @see https://docs.stripe.com/api/charges/object
 */
export const CHARGE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the charge' },
  object: { type: 'string', description: 'String representing the object type (charge)' },
  amount: { type: 'number', description: 'Amount in smallest currency unit' },
  amount_captured: { type: 'number', description: 'Amount captured' },
  amount_refunded: { type: 'number', description: 'Amount refunded' },
  application: {
    type: 'string',
    description: 'ID of the Connect application that created the charge',
    optional: true,
  },
  application_fee: { type: 'string', description: 'ID of the application fee', optional: true },
  application_fee_amount: { type: 'number', description: 'Application fee amount', optional: true },
  balance_transaction: {
    type: 'string',
    description: 'ID of the balance transaction',
    optional: true,
  },
  billing_details: {
    type: 'json',
    description: 'Billing information associated with the payment method',
  },
  calculated_statement_descriptor: {
    type: 'string',
    description: 'Full statement descriptor',
    optional: true,
  },
  captured: { type: 'boolean', description: 'Whether the charge has been captured' },
  created: { type: 'number', description: 'Unix timestamp when the charge was created' },
  currency: { type: 'string', description: 'Three-letter ISO currency code (lowercase)' },
  customer: { type: 'string', description: 'ID of the customer', optional: true },
  description: { type: 'string', description: 'Description of the charge', optional: true },
  destination: { type: 'string', description: 'ID of the destination account', optional: true },
  dispute: { type: 'string', description: 'ID of the dispute', optional: true },
  disputed: { type: 'boolean', description: 'Whether the charge has been disputed' },
  failure_balance_transaction: {
    type: 'string',
    description: 'ID of the balance transaction for failure',
    optional: true,
  },
  failure_code: {
    type: 'string',
    description: 'Error code explaining the failure',
    optional: true,
  },
  failure_message: {
    type: 'string',
    description: 'Message describing the failure',
    optional: true,
  },
  fraud_details: { type: 'json', description: 'Information on fraud assessments', optional: true },
  invoice: { type: 'string', description: 'ID of the invoice', optional: true },
  livemode: { type: 'boolean', description: 'Whether object exists in live mode or test mode' },
  metadata: {
    type: 'json',
    description: 'Set of key-value pairs for storing additional information',
  },
  on_behalf_of: {
    type: 'string',
    description: 'Account on behalf of which the charge was made',
    optional: true,
  },
  outcome: {
    type: 'json',
    description: 'Details about whether the payment was accepted',
    optional: true,
  },
  paid: { type: 'boolean', description: 'Whether the charge has been paid' },
  payment_intent: { type: 'string', description: 'ID of the PaymentIntent', optional: true },
  payment_method: { type: 'string', description: 'ID of the payment method used', optional: true },
  payment_method_details: {
    type: 'json',
    description: 'Details about the payment method',
    optional: true,
  },
  radar_options: { type: 'json', description: 'Options to configure Radar', optional: true },
  receipt_email: { type: 'string', description: 'Email address for the receipt', optional: true },
  receipt_number: { type: 'string', description: 'Receipt number', optional: true },
  receipt_url: { type: 'string', description: 'URL for the receipt', optional: true },
  refunded: { type: 'boolean', description: 'Whether the charge has been fully refunded' },
  refunds: { type: 'json', description: 'List of refunds applied to the charge', optional: true },
  review: { type: 'string', description: 'ID of the review', optional: true },
  shipping: SHIPPING_OUTPUT,
  source: { type: 'json', description: 'Deprecated payment source', optional: true },
  source_transfer: { type: 'string', description: 'ID of the source transfer', optional: true },
  statement_descriptor: {
    type: 'string',
    description: 'Statement descriptor on card statements',
    optional: true,
  },
  statement_descriptor_suffix: {
    type: 'string',
    description: 'Statement descriptor suffix',
    optional: true,
  },
  status: { type: 'string', description: 'Status of the charge (succeeded, pending, failed)' },
  transfer: { type: 'string', description: 'ID of the transfer', optional: true },
  transfer_data: { type: 'json', description: 'Data for creating a transfer', optional: true },
  transfer_group: { type: 'string', description: 'Transfer group', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete Charge object output definition
 */
export const CHARGE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Stripe Charge object',
  properties: CHARGE_OUTPUT_PROPERTIES,
}

/**
 * Output definition for Charge metadata (summary)
 */
export const CHARGE_METADATA_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Stripe unique identifier' },
  status: { type: 'string', description: 'Current state of the resource' },
  amount: { type: 'number', description: 'Amount in smallest currency unit (e.g., cents)' },
  currency: { type: 'string', description: 'Three-letter ISO currency code (lowercase)' },
  paid: { type: 'boolean', description: 'Whether payment has been received' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for Product objects
 * @see https://docs.stripe.com/api/products/object
 */
export const PRODUCT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the product' },
  object: { type: 'string', description: 'String representing the object type (product)' },
  active: {
    type: 'boolean',
    description: 'Whether the product is currently available for purchase',
  },
  created: { type: 'number', description: 'Unix timestamp when the product was created' },
  default_price: { type: 'string', description: 'ID of the default Price', optional: true },
  description: {
    type: 'string',
    description: 'Product description (for customers)',
    optional: true,
  },
  images: { type: 'array', description: 'List of up to 8 image URLs', items: { type: 'string' } },
  livemode: { type: 'boolean', description: 'Whether object exists in live mode or test mode' },
  marketing_features: {
    type: 'array',
    description: 'List of up to 15 marketing features',
    optional: true,
    items: { type: 'object' },
  },
  metadata: {
    type: 'json',
    description: 'Set of key-value pairs for storing additional information',
  },
  name: { type: 'string', description: 'Product name (for customers)' },
  package_dimensions: {
    type: 'json',
    description: 'Dimensions of the product for shipping',
    optional: true,
  },
  shippable: { type: 'boolean', description: 'Whether the product is shippable', optional: true },
  statement_descriptor: { type: 'string', description: 'Statement descriptor', optional: true },
  tax_code: { type: 'string', description: 'Tax code ID', optional: true },
  type: { type: 'string', description: 'Type of the product (good or service)', optional: true },
  unit_label: { type: 'string', description: 'Label for quantity units', optional: true },
  updated: { type: 'number', description: 'Unix timestamp when the product was last updated' },
  url: { type: 'string', description: 'URL of a publicly-accessible webpage', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete Product object output definition
 */
export const PRODUCT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Stripe Product object',
  properties: PRODUCT_OUTPUT_PROPERTIES,
}

/**
 * Output definition for Product metadata (summary)
 */
export const PRODUCT_METADATA_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Stripe unique identifier' },
  name: { type: 'string', description: 'Display name' },
  active: { type: 'boolean', description: 'Whether the resource is currently active' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for Price recurring object
 * @see https://docs.stripe.com/api/prices/object#price_object-recurring
 */
export const PRICE_RECURRING_OUTPUT_PROPERTIES = {
  aggregate_usage: {
    type: 'string',
    description: 'Specifies a usage aggregation strategy',
    optional: true,
  },
  interval: { type: 'string', description: 'Billing frequency (day, week, month, year)' },
  interval_count: { type: 'number', description: 'Number of intervals between billings' },
  meter: { type: 'string', description: 'ID of the metering system', optional: true },
  trial_period_days: {
    type: 'number',
    description: 'Default number of trial days',
    optional: true,
  },
  usage_type: { type: 'string', description: 'Usage type (metered or licensed)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete Price recurring output definition
 */
export const PRICE_RECURRING_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Recurring billing configuration',
  optional: true,
  properties: PRICE_RECURRING_OUTPUT_PROPERTIES,
}

/**
 * Output definition for Price objects
 * @see https://docs.stripe.com/api/prices/object
 */
export const PRICE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the price' },
  object: { type: 'string', description: 'String representing the object type (price)' },
  active: { type: 'boolean', description: 'Whether the price can be used for new purchases' },
  billing_scheme: { type: 'string', description: 'Billing scheme (per_unit or tiered)' },
  created: { type: 'number', description: 'Unix timestamp when the price was created' },
  currency: { type: 'string', description: 'Three-letter ISO currency code (lowercase)' },
  currency_options: { type: 'json', description: 'Prices in different currencies', optional: true },
  custom_unit_amount: { type: 'json', description: 'Custom unit amount settings', optional: true },
  livemode: { type: 'boolean', description: 'Whether object exists in live mode or test mode' },
  lookup_key: { type: 'string', description: 'Lookup key for transferring prices', optional: true },
  metadata: {
    type: 'json',
    description: 'Set of key-value pairs for storing additional information',
  },
  nickname: { type: 'string', description: 'Brief description of the price', optional: true },
  product: { type: 'string', description: 'ID of the product this price is associated with' },
  recurring: PRICE_RECURRING_OUTPUT,
  tax_behavior: {
    type: 'string',
    description: 'Tax behavior (inclusive, exclusive, unspecified)',
    optional: true,
  },
  tiers: {
    type: 'array',
    description: 'Each tier specifies an upper bound',
    optional: true,
    items: { type: 'object' },
  },
  tiers_mode: {
    type: 'string',
    description: 'Defines if tiering should be graduated or volume',
    optional: true,
  },
  transform_quantity: {
    type: 'json',
    description: 'Apply a transformation to the reported usage',
    optional: true,
  },
  type: { type: 'string', description: 'Type of the price (one_time or recurring)' },
  unit_amount: {
    type: 'number',
    description: 'Unit amount in smallest currency unit',
    optional: true,
  },
  unit_amount_decimal: {
    type: 'string',
    description: 'Unit amount in decimal string',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete Price object output definition
 */
export const PRICE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Stripe Price object',
  properties: PRICE_OUTPUT_PROPERTIES,
}

/**
 * Output definition for Price metadata (summary)
 */
export const PRICE_METADATA_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Stripe unique identifier' },
  product: { type: 'string', description: 'Associated product ID' },
  unit_amount: {
    type: 'number',
    description: 'Amount in smallest currency unit (e.g., cents)',
    optional: true,
  },
  currency: { type: 'string', description: 'Three-letter ISO currency code (lowercase)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for Event request object
 * @see https://docs.stripe.com/api/events/object#event_object-request
 */
export const EVENT_REQUEST_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'ID of the API request', optional: true },
  idempotency_key: {
    type: 'string',
    description: 'Idempotency key of the request',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete Event request output definition
 */
export const EVENT_REQUEST_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Information on the API request that triggers the event',
  optional: true,
  properties: EVENT_REQUEST_OUTPUT_PROPERTIES,
}

/**
 * Output definition for Event objects
 * @see https://docs.stripe.com/api/events/object
 */
export const EVENT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the event' },
  object: { type: 'string', description: 'String representing the object type (event)' },
  account: {
    type: 'string',
    description: 'Connected account that originated the event',
    optional: true,
  },
  api_version: {
    type: 'string',
    description: 'Stripe API version used to render data',
    optional: true,
  },
  created: { type: 'number', description: 'Unix timestamp when the event was created' },
  data: {
    type: 'object',
    description: 'Object containing data associated with the event',
    properties: {
      object: { type: 'json', description: 'Object that the event is about' },
      previous_attributes: {
        type: 'json',
        description: 'Previous values of changed attributes',
        optional: true,
      },
    },
  },
  livemode: { type: 'boolean', description: 'Whether object exists in live mode or test mode' },
  pending_webhooks: { type: 'number', description: 'Number of pending webhooks' },
  request: EVENT_REQUEST_OUTPUT,
  type: { type: 'string', description: 'Event type (e.g., invoice.created, charge.refunded)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete Event object output definition
 */
export const EVENT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Stripe Event object',
  properties: EVENT_OUTPUT_PROPERTIES,
}

/**
 * Output definition for Event metadata (summary)
 */
export const EVENT_METADATA_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Stripe unique identifier' },
  type: { type: 'string', description: 'Event type identifier' },
  created: { type: 'number', description: 'Unix timestamp of creation' },
} as const satisfies Record<string, OutputProperty>

/**
 * Pagination output properties for list endpoints
 */
export const LIST_METADATA_OUTPUT_PROPERTIES = {
  count: { type: 'number', description: 'Number of items returned' },
  has_more: { type: 'boolean', description: 'Whether more items exist beyond this page' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete list metadata output definition
 */
export const LIST_METADATA_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'List metadata',
  properties: LIST_METADATA_OUTPUT_PROPERTIES,
}

/**
 * Delete response output properties
 */
export const DELETE_OUTPUT_PROPERTIES = {
  deleted: { type: 'boolean', description: 'Whether the resource was deleted' },
  id: { type: 'string', description: 'ID of the deleted resource' },
} as const satisfies Record<string, OutputProperty>

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
