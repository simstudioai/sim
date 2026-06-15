import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared constants, output property definitions, and TypeScript interfaces for
 * the Square API. Reused across all Square tools to keep request building and
 * output shapes consistent.
 *
 * @see https://developer.squareup.com/reference/square
 */

/** Square production API base URL. */
export const SQUARE_BASE_URL = 'https://connect.squareup.com'

/**
 * Square API version pinned for every request via the `Square-Version` header.
 * Square is a date-versioned API; pinning avoids silent breaking changes.
 */
export const SQUARE_API_VERSION = '2026-05-20'

/**
 * Standard headers for a JSON Square request authenticated with a personal
 * access token (or any Square access token) as a bearer token.
 */
export function squareHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Square-Version': SQUARE_API_VERSION,
    'Content-Type': 'application/json',
  }
}

/**
 * Output definition for a Square Money object.
 * @see https://developer.squareup.com/reference/square/objects/Money
 */
export const MONEY_OUTPUT_PROPERTIES = {
  amount: {
    type: 'number',
    description: 'Amount in the smallest denomination of the currency (e.g. cents for USD)',
    optional: true,
  },
  currency: {
    type: 'string',
    description: 'Three-letter ISO 4217 currency code (e.g. USD)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const MONEY_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Monetary amount with a currency',
  optional: true,
  properties: MONEY_OUTPUT_PROPERTIES,
}

/**
 * Output definition for a Square Address object.
 * @see https://developer.squareup.com/reference/square/objects/Address
 */
export const ADDRESS_OUTPUT_PROPERTIES = {
  address_line_1: { type: 'string', description: 'First line of the address', optional: true },
  address_line_2: { type: 'string', description: 'Second line of the address', optional: true },
  address_line_3: { type: 'string', description: 'Third line of the address', optional: true },
  locality: { type: 'string', description: 'City or town', optional: true },
  sublocality: { type: 'string', description: 'Neighborhood or district', optional: true },
  administrative_district_level_1: {
    type: 'string',
    description: 'State, province, or region',
    optional: true,
  },
  postal_code: { type: 'string', description: 'Postal or ZIP code', optional: true },
  country: {
    type: 'string',
    description: 'Two-letter ISO 3166-1 alpha-2 country code',
    optional: true,
  },
  first_name: { type: 'string', description: 'First name of the addressee', optional: true },
  last_name: { type: 'string', description: 'Last name of the addressee', optional: true },
} as const satisfies Record<string, OutputProperty>

export const ADDRESS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Physical address',
  optional: true,
  properties: ADDRESS_OUTPUT_PROPERTIES,
}

/**
 * Output definition for a Square Payment object.
 * @see https://developer.squareup.com/reference/square/objects/Payment
 */
export const PAYMENT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique ID for the payment' },
  status: {
    type: 'string',
    description: 'Payment status (APPROVED, PENDING, COMPLETED, CANCELED, or FAILED)',
    optional: true,
  },
  amount_money: MONEY_OUTPUT,
  total_money: MONEY_OUTPUT,
  approved_money: MONEY_OUTPUT,
  app_fee_money: MONEY_OUTPUT,
  refunded_money: MONEY_OUTPUT,
  tip_money: MONEY_OUTPUT,
  source_type: {
    type: 'string',
    description: 'Source of the payment (CARD, BANK_ACCOUNT, WALLET, etc.)',
    optional: true,
  },
  card_details: { type: 'json', description: 'Details about a card payment', optional: true },
  location_id: {
    type: 'string',
    description: 'ID of the location where the payment was taken',
    optional: true,
  },
  order_id: { type: 'string', description: 'ID of the associated order', optional: true },
  customer_id: { type: 'string', description: 'ID of the associated customer', optional: true },
  reference_id: {
    type: 'string',
    description: 'Optional external reference for the payment',
    optional: true,
  },
  receipt_number: { type: 'string', description: 'Receipt number for the payment', optional: true },
  receipt_url: { type: 'string', description: 'URL of the payment receipt', optional: true },
  note: { type: 'string', description: 'Optional note attached to the payment', optional: true },
  refund_ids: {
    type: 'array',
    description: 'IDs of refunds associated with the payment',
    optional: true,
    items: { type: 'string' },
  },
  processing_fee: {
    type: 'array',
    description: 'Processing fees applied to the payment',
    optional: true,
    items: { type: 'object' },
  },
  created_at: { type: 'string', description: 'Timestamp when the payment was created (RFC 3339)' },
  updated_at: {
    type: 'string',
    description: 'Timestamp when the payment was last updated (RFC 3339)',
    optional: true,
  },
  version_token: {
    type: 'string',
    description: 'Optimistic concurrency token for the payment',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PAYMENT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Square Payment object',
  properties: PAYMENT_OUTPUT_PROPERTIES,
}

export const PAYMENT_METADATA_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Square payment ID' },
  status: { type: 'string', description: 'Current payment status', optional: true },
  order_id: { type: 'string', description: 'Associated order ID', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for a Square PaymentRefund object.
 * @see https://developer.squareup.com/reference/square/objects/PaymentRefund
 */
export const REFUND_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique ID for the refund' },
  status: {
    type: 'string',
    description: 'Refund status (PENDING, COMPLETED, REJECTED, or FAILED)',
    optional: true,
  },
  amount_money: MONEY_OUTPUT,
  processing_fee: {
    type: 'array',
    description: 'Processing fees refunded',
    optional: true,
    items: { type: 'object' },
  },
  payment_id: { type: 'string', description: 'ID of the payment being refunded', optional: true },
  order_id: { type: 'string', description: 'ID of the associated order', optional: true },
  location_id: { type: 'string', description: 'ID of the associated location', optional: true },
  reason: { type: 'string', description: 'Reason for the refund', optional: true },
  created_at: { type: 'string', description: 'Timestamp when the refund was created (RFC 3339)' },
  updated_at: {
    type: 'string',
    description: 'Timestamp when the refund was last updated (RFC 3339)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const REFUND_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Square PaymentRefund object',
  properties: REFUND_OUTPUT_PROPERTIES,
}

export const REFUND_METADATA_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Square refund ID' },
  status: { type: 'string', description: 'Current refund status', optional: true },
  payment_id: { type: 'string', description: 'Refunded payment ID', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for a Square Customer object.
 * @see https://developer.squareup.com/reference/square/objects/Customer
 */
export const CUSTOMER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique ID for the customer' },
  given_name: { type: 'string', description: 'First name of the customer', optional: true },
  family_name: { type: 'string', description: 'Last name of the customer', optional: true },
  nickname: { type: 'string', description: 'Nickname of the customer', optional: true },
  company_name: { type: 'string', description: 'Business name of the customer', optional: true },
  email_address: { type: 'string', description: 'Email address of the customer', optional: true },
  phone_number: { type: 'string', description: 'Phone number of the customer', optional: true },
  address: ADDRESS_OUTPUT,
  birthday: {
    type: 'string',
    description: 'Birthday in YYYY-MM-DD or MM-DD format',
    optional: true,
  },
  reference_id: {
    type: 'string',
    description: 'Optional external reference for the customer',
    optional: true,
  },
  note: { type: 'string', description: 'Note about the customer', optional: true },
  creation_source: {
    type: 'string',
    description: 'How the customer profile was created',
    optional: true,
  },
  preferences: { type: 'json', description: 'Customer communication preferences', optional: true },
  group_ids: {
    type: 'array',
    description: 'IDs of customer groups the customer belongs to',
    optional: true,
    items: { type: 'string' },
  },
  segment_ids: {
    type: 'array',
    description: 'IDs of customer segments the customer belongs to',
    optional: true,
    items: { type: 'string' },
  },
  version: {
    type: 'number',
    description: 'Optimistic concurrency version of the customer',
    optional: true,
  },
  created_at: { type: 'string', description: 'Timestamp when the customer was created (RFC 3339)' },
  updated_at: {
    type: 'string',
    description: 'Timestamp when the customer was last updated (RFC 3339)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const CUSTOMER_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Square Customer object',
  properties: CUSTOMER_OUTPUT_PROPERTIES,
}

export const CUSTOMER_METADATA_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Square customer ID' },
  email_address: { type: 'string', description: 'Customer email address', optional: true },
  given_name: { type: 'string', description: 'Customer first name', optional: true },
  family_name: { type: 'string', description: 'Customer last name', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for a Square Location object.
 * @see https://developer.squareup.com/reference/square/objects/Location
 */
export const LOCATION_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique ID for the location' },
  name: { type: 'string', description: 'Name of the location', optional: true },
  address: ADDRESS_OUTPUT,
  timezone: { type: 'string', description: 'IANA timezone of the location', optional: true },
  status: { type: 'string', description: 'Location status (ACTIVE or INACTIVE)', optional: true },
  type: { type: 'string', description: 'Location type (PHYSICAL or MOBILE)', optional: true },
  merchant_id: {
    type: 'string',
    description: 'ID of the merchant that owns the location',
    optional: true,
  },
  country: { type: 'string', description: 'Country code of the location', optional: true },
  language_code: { type: 'string', description: 'Language code of the location', optional: true },
  currency: { type: 'string', description: 'Currency used by the location', optional: true },
  phone_number: { type: 'string', description: 'Phone number of the location', optional: true },
  business_name: {
    type: 'string',
    description: 'Business name shown to customers',
    optional: true,
  },
  business_email: { type: 'string', description: 'Email of the business', optional: true },
  description: { type: 'string', description: 'Description of the location', optional: true },
  capabilities: {
    type: 'array',
    description: 'Capabilities of the location (e.g. CREDIT_CARD_PROCESSING)',
    optional: true,
    items: { type: 'string' },
  },
  created_at: {
    type: 'string',
    description: 'Timestamp when the location was created (RFC 3339)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const LOCATION_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Square Location object',
  properties: LOCATION_OUTPUT_PROPERTIES,
}

/**
 * Output definition for a Square Order object.
 * @see https://developer.squareup.com/reference/square/objects/Order
 */
export const ORDER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique ID for the order' },
  location_id: { type: 'string', description: 'ID of the location for the order', optional: true },
  reference_id: {
    type: 'string',
    description: 'Optional external reference for the order',
    optional: true,
  },
  customer_id: { type: 'string', description: 'ID of the associated customer', optional: true },
  state: {
    type: 'string',
    description: 'Order state (OPEN, COMPLETED, or CANCELED)',
    optional: true,
  },
  version: {
    type: 'number',
    description: 'Optimistic concurrency version of the order',
    optional: true,
  },
  line_items: {
    type: 'array',
    description: 'Line items in the order',
    optional: true,
    items: { type: 'object' },
  },
  taxes: {
    type: 'array',
    description: 'Taxes applied to the order',
    optional: true,
    items: { type: 'object' },
  },
  discounts: {
    type: 'array',
    description: 'Discounts applied to the order',
    optional: true,
    items: { type: 'object' },
  },
  fulfillments: {
    type: 'array',
    description: 'Fulfillments for the order',
    optional: true,
    items: { type: 'object' },
  },
  net_amounts: { type: 'json', description: 'Net money amounts for the order', optional: true },
  total_money: MONEY_OUTPUT,
  total_tax_money: MONEY_OUTPUT,
  total_discount_money: MONEY_OUTPUT,
  total_service_charge_money: MONEY_OUTPUT,
  total_tip_money: MONEY_OUTPUT,
  created_at: {
    type: 'string',
    description: 'Timestamp when the order was created (RFC 3339)',
    optional: true,
  },
  updated_at: {
    type: 'string',
    description: 'Timestamp when the order was last updated (RFC 3339)',
    optional: true,
  },
  closed_at: {
    type: 'string',
    description: 'Timestamp when the order was closed (RFC 3339)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const ORDER_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Square Order object',
  properties: ORDER_OUTPUT_PROPERTIES,
}

export const ORDER_METADATA_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Square order ID' },
  state: { type: 'string', description: 'Current order state', optional: true },
  location_id: { type: 'string', description: 'Order location ID', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for a Square Invoice object.
 * @see https://developer.squareup.com/reference/square/objects/Invoice
 */
export const INVOICE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique ID for the invoice' },
  version: {
    type: 'number',
    description: 'Optimistic concurrency version of the invoice',
    optional: true,
  },
  location_id: {
    type: 'string',
    description: 'ID of the location for the invoice',
    optional: true,
  },
  order_id: {
    type: 'string',
    description: 'ID of the order the invoice bills for',
    optional: true,
  },
  status: {
    type: 'string',
    description: 'Invoice status (DRAFT, UNPAID, SCHEDULED, PARTIALLY_PAID, PAID, etc.)',
    optional: true,
  },
  invoice_number: { type: 'string', description: 'Human-readable invoice number', optional: true },
  title: { type: 'string', description: 'Title of the invoice', optional: true },
  description: { type: 'string', description: 'Description of the invoice', optional: true },
  public_url: {
    type: 'string',
    description: 'URL where the customer can view and pay the invoice',
    optional: true,
  },
  primary_recipient: {
    type: 'json',
    description: 'Primary recipient of the invoice',
    optional: true,
  },
  payment_requests: {
    type: 'array',
    description: 'Payment requests for the invoice',
    optional: true,
    items: { type: 'object' },
  },
  next_payment_amount_money: MONEY_OUTPUT,
  scheduled_at: {
    type: 'string',
    description: 'Timestamp when the invoice is scheduled to be sent (RFC 3339)',
    optional: true,
  },
  timezone: { type: 'string', description: 'Timezone used for invoice dates', optional: true },
  delivery_method: {
    type: 'string',
    description: 'How the invoice is delivered (EMAIL, SHARE_MANUALLY, SMS)',
    optional: true,
  },
  created_at: {
    type: 'string',
    description: 'Timestamp when the invoice was created (RFC 3339)',
    optional: true,
  },
  updated_at: {
    type: 'string',
    description: 'Timestamp when the invoice was last updated (RFC 3339)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const INVOICE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Square Invoice object',
  properties: INVOICE_OUTPUT_PROPERTIES,
}

export const INVOICE_METADATA_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Square invoice ID' },
  status: { type: 'string', description: 'Current invoice status', optional: true },
  version: { type: 'number', description: 'Invoice version', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for a Square CatalogObject.
 * Catalog objects are polymorphic; type-specific data lives in `*_data` fields.
 * @see https://developer.squareup.com/reference/square/objects/CatalogObject
 */
export const CATALOG_OBJECT_OUTPUT_PROPERTIES = {
  type: {
    type: 'string',
    description: 'Type of catalog object (ITEM, ITEM_VARIATION, CATEGORY, IMAGE, etc.)',
  },
  id: { type: 'string', description: 'Unique ID for the catalog object' },
  version: {
    type: 'number',
    description: 'Optimistic concurrency version of the object',
    optional: true,
  },
  updated_at: {
    type: 'string',
    description: 'Timestamp when the object was last updated (RFC 3339)',
    optional: true,
  },
  is_deleted: { type: 'boolean', description: 'Whether the object is deleted', optional: true },
  present_at_all_locations: {
    type: 'boolean',
    description: 'Whether the object is present at all locations',
    optional: true,
  },
  item_data: {
    type: 'json',
    description: 'Item-specific data (when type is ITEM)',
    optional: true,
  },
  item_variation_data: {
    type: 'json',
    description: 'Variation-specific data (when type is ITEM_VARIATION)',
    optional: true,
  },
  category_data: {
    type: 'json',
    description: 'Category-specific data (when type is CATEGORY)',
    optional: true,
  },
  image_data: {
    type: 'json',
    description: 'Image-specific data (when type is IMAGE)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const CATALOG_OBJECT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Square CatalogObject',
  properties: CATALOG_OBJECT_OUTPUT_PROPERTIES,
}

export const CATALOG_OBJECT_METADATA_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Square catalog object ID' },
  type: { type: 'string', description: 'Catalog object type', optional: true },
  version: { type: 'number', description: 'Catalog object version', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for a Square InventoryCount object.
 * @see https://developer.squareup.com/reference/square/objects/InventoryCount
 */
export const INVENTORY_COUNT_OUTPUT_PROPERTIES = {
  catalog_object_id: {
    type: 'string',
    description: 'ID of the catalog object (item variation) being counted',
    optional: true,
  },
  catalog_object_type: {
    type: 'string',
    description: 'Type of the counted catalog object (usually ITEM_VARIATION)',
    optional: true,
  },
  state: {
    type: 'string',
    description: 'Inventory state (e.g. IN_STOCK, SOLD, WASTE)',
    optional: true,
  },
  location_id: { type: 'string', description: 'ID of the location for this count', optional: true },
  quantity: {
    type: 'string',
    description: 'Number of units in the given state at the location',
    optional: true,
  },
  calculated_at: {
    type: 'string',
    description: 'Timestamp when the count was calculated (RFC 3339)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const INVENTORY_COUNT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Square InventoryCount object',
  properties: INVENTORY_COUNT_OUTPUT_PROPERTIES,
}

/**
 * Pagination metadata for cursor-paged Square list/search endpoints.
 */
export const LIST_METADATA_OUTPUT_PROPERTIES = {
  count: { type: 'number', description: 'Number of items returned in this page' },
  cursor: {
    type: 'string',
    description: 'Pagination cursor to fetch the next page, if more results exist',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const LIST_METADATA_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'List pagination metadata',
  properties: LIST_METADATA_OUTPUT_PROPERTIES,
}

interface SquareMoney {
  amount?: number
  currency?: string
}

interface SquareAddress {
  address_line_1?: string
  address_line_2?: string
  locality?: string
  administrative_district_level_1?: string
  postal_code?: string
  country?: string
  [key: string]: unknown
}

interface SquareListMetadata {
  count: number
  cursor?: string
}

interface PaymentObject {
  id: string
  status?: string
  amount_money?: SquareMoney
  order_id?: string
  created_at: string
  [key: string]: unknown
}

interface RefundObject {
  id: string
  status?: string
  amount_money?: SquareMoney
  payment_id?: string
  created_at: string
  [key: string]: unknown
}

interface CustomerObject {
  id: string
  given_name?: string
  family_name?: string
  email_address?: string
  created_at: string
  [key: string]: unknown
}

interface LocationObject {
  id: string
  name?: string
  [key: string]: unknown
}

interface OrderObject {
  id: string
  state?: string
  location_id?: string
  [key: string]: unknown
}

interface InvoiceObject {
  id: string
  status?: string
  version?: number
  [key: string]: unknown
}

interface CatalogObject {
  id: string
  type: string
  version?: number
  [key: string]: unknown
}

interface InventoryCountObject {
  catalog_object_id?: string
  catalog_object_type?: string
  state?: string
  location_id?: string
  quantity?: string
  calculated_at?: string
  [key: string]: unknown
}

export interface CreatePaymentParams {
  apiKey: string
  sourceId: string
  amount: number
  currency: string
  idempotencyKey?: string
  customerId?: string
  locationId?: string
  orderId?: string
  referenceId?: string
  note?: string
  autocomplete?: boolean
}

export interface GetPaymentParams {
  apiKey: string
  paymentId: string
}

export interface ListPaymentsParams {
  apiKey: string
  locationId?: string
  beginTime?: string
  endTime?: string
  limit?: number
  cursor?: string
}

export interface RefundPaymentParams {
  apiKey: string
  paymentId: string
  amount: number
  currency: string
  idempotencyKey?: string
  reason?: string
}

export interface CreateCustomerParams {
  apiKey: string
  givenName?: string
  familyName?: string
  companyName?: string
  nickname?: string
  emailAddress?: string
  phoneNumber?: string
  birthday?: string
  note?: string
  referenceId?: string
  address?: SquareAddress
  idempotencyKey?: string
}

export interface GetCustomerParams {
  apiKey: string
  customerId: string
}

export interface ListCustomersParams {
  apiKey: string
  limit?: number
  cursor?: string
  sortField?: string
  sortOrder?: string
}

export interface SearchCustomersParams {
  apiKey: string
  query?: Record<string, unknown>
  limit?: number
  cursor?: string
}

export interface UpdateCustomerParams {
  apiKey: string
  customerId: string
  givenName?: string
  familyName?: string
  companyName?: string
  nickname?: string
  emailAddress?: string
  phoneNumber?: string
  birthday?: string
  note?: string
  referenceId?: string
  address?: SquareAddress
}

export interface DeleteCustomerParams {
  apiKey: string
  customerId: string
}

export interface ListLocationsParams {
  apiKey: string
}

export interface CreateOrderParams {
  apiKey: string
  order: Record<string, unknown>
  idempotencyKey?: string
}

export interface GetOrderParams {
  apiKey: string
  orderId: string
}

export interface SearchOrdersParams {
  apiKey: string
  locationIds: string[]
  query?: Record<string, unknown>
  limit?: number
  cursor?: string
}

export interface CreateInvoiceParams {
  apiKey: string
  invoice: Record<string, unknown>
  idempotencyKey?: string
}

export interface GetInvoiceParams {
  apiKey: string
  invoiceId: string
}

export interface ListInvoicesParams {
  apiKey: string
  locationId: string
  limit?: number
  cursor?: string
}

export interface PublishInvoiceParams {
  apiKey: string
  invoiceId: string
  version: number
  idempotencyKey?: string
}

export interface UpsertCatalogObjectParams {
  apiKey: string
  object: Record<string, unknown>
  idempotencyKey?: string
}

export interface GetCatalogObjectParams {
  apiKey: string
  objectId: string
  includeRelatedObjects?: boolean
}

export interface ListCatalogParams {
  apiKey: string
  types?: string
  cursor?: string
}

export interface SearchCatalogObjectsParams {
  apiKey: string
  objectTypes?: string[]
  query?: Record<string, unknown>
  limit?: number
  cursor?: string
}

export interface CreateCatalogImageParams {
  apiKey: string
  file?: unknown
  fileName?: string
  objectId?: string
  caption?: string
  idempotencyKey?: string
}

export interface CancelPaymentParams {
  apiKey: string
  paymentId: string
}

export interface CompletePaymentParams {
  apiKey: string
  paymentId: string
  versionToken?: string
}

export interface GetRefundParams {
  apiKey: string
  refundId: string
}

export interface ListRefundsParams {
  apiKey: string
  locationId?: string
  status?: string
  beginTime?: string
  endTime?: string
  limit?: number
  cursor?: string
}

export interface PayOrderParams {
  apiKey: string
  orderId: string
  orderVersion?: number
  paymentIds?: string[]
  idempotencyKey?: string
}

export interface SearchInvoicesParams {
  apiKey: string
  locationId: string
  limit?: number
  cursor?: string
}

export interface CancelInvoiceParams {
  apiKey: string
  invoiceId: string
  version: number
}

export interface DeleteInvoiceParams {
  apiKey: string
  invoiceId: string
  version?: number
}

export interface DeleteCatalogObjectParams {
  apiKey: string
  objectId: string
}

export interface GetLocationParams {
  apiKey: string
  locationId: string
}

export interface BatchRetrieveInventoryCountsParams {
  apiKey: string
  catalogObjectIds?: string[]
  locationIds?: string[]
  states?: string[]
  updatedAfter?: string
  limit?: number
  cursor?: string
}

export interface PaymentResponse extends ToolResponse {
  output: {
    payment: PaymentObject
    metadata: { id: string; status?: string; order_id?: string }
  }
}

export interface PaymentListResponse extends ToolResponse {
  output: {
    payments: PaymentObject[]
    metadata: SquareListMetadata
  }
}

export interface RefundResponse extends ToolResponse {
  output: {
    refund: RefundObject
    metadata: { id: string; status?: string; payment_id?: string }
  }
}

export interface CustomerResponse extends ToolResponse {
  output: {
    customer: CustomerObject
    metadata: { id: string; email_address?: string; given_name?: string; family_name?: string }
  }
}

export interface CustomerListResponse extends ToolResponse {
  output: {
    customers: CustomerObject[]
    metadata: SquareListMetadata
  }
}

export interface CustomerDeleteResponse extends ToolResponse {
  output: {
    deleted: boolean
    id: string
  }
}

export interface LocationListResponse extends ToolResponse {
  output: {
    locations: LocationObject[]
    metadata: { count: number }
  }
}

export interface OrderResponse extends ToolResponse {
  output: {
    order: OrderObject
    metadata: { id: string; state?: string; location_id?: string }
  }
}

export interface OrderListResponse extends ToolResponse {
  output: {
    orders: OrderObject[]
    metadata: SquareListMetadata
  }
}

export interface InvoiceResponse extends ToolResponse {
  output: {
    invoice: InvoiceObject
    metadata: { id: string; status?: string; version?: number }
  }
}

export interface InvoiceListResponse extends ToolResponse {
  output: {
    invoices: InvoiceObject[]
    metadata: SquareListMetadata
  }
}

export interface CatalogObjectResponse extends ToolResponse {
  output: {
    object: CatalogObject
    metadata: { id: string; type?: string; version?: number }
  }
}

export interface CatalogListResponse extends ToolResponse {
  output: {
    objects: CatalogObject[]
    metadata: SquareListMetadata
  }
}

export interface RefundListResponse extends ToolResponse {
  output: {
    refunds: RefundObject[]
    metadata: SquareListMetadata
  }
}

export interface LocationResponse extends ToolResponse {
  output: {
    location: LocationObject
    metadata: { id: string; name?: string }
  }
}

export interface InvoiceDeleteResponse extends ToolResponse {
  output: {
    deleted: boolean
    id: string
  }
}

export interface CatalogDeleteResponse extends ToolResponse {
  output: {
    deleted: boolean
    deleted_object_ids: string[]
    deleted_at: string | null
  }
}

export interface InventoryCountListResponse extends ToolResponse {
  output: {
    counts: InventoryCountObject[]
    metadata: SquareListMetadata
  }
}

export type SquareResponse =
  | PaymentResponse
  | PaymentListResponse
  | RefundResponse
  | RefundListResponse
  | CustomerResponse
  | CustomerListResponse
  | CustomerDeleteResponse
  | LocationListResponse
  | LocationResponse
  | OrderResponse
  | OrderListResponse
  | InvoiceResponse
  | InvoiceListResponse
  | InvoiceDeleteResponse
  | CatalogObjectResponse
  | CatalogListResponse
  | CatalogDeleteResponse
  | InventoryCountListResponse
