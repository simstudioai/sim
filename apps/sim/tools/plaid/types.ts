import type { ToolOutputProperty, ToolResponse } from '@/tools/types'

/** Credential params shared by every Plaid tool. */
export interface PlaidBaseParams {
  plaidCredentialId: string
}

export type PlaidGetItemParams = PlaidBaseParams

export interface PlaidSyncTransactionsParams extends PlaidBaseParams {
  cursor?: string
  count?: number
  accountId?: string
  includeOriginalDescription?: boolean
  daysRequested?: number
}

export interface PlaidSearchInstitutionsParams extends PlaidBaseParams {
  query: string
  countryCodes?: string
  products?: string
}

export interface PlaidGetInstitutionParams extends PlaidBaseParams {
  institutionId: string
  countryCodes?: string
}

export interface PlaidGetAccountsParams extends PlaidBaseParams {
  accountIds?: string | string[]
}

export interface PlaidGetBalancesParams extends PlaidGetAccountsParams {
  minLastUpdatedDatetime?: string
}

export type PlaidGetAuthParams = PlaidGetAccountsParams

export type PlaidGetIdentityParams = PlaidGetAccountsParams

/** Item metadata returned by /item/get. Field names mirror the Plaid API. */
export interface PlaidItem {
  item_id: string
  institution_id?: string | null
  institution_name?: string | null
  webhook: string | null
  error: PlaidError | null
  available_products: string[]
  billed_products: string[]
  products?: string[]
  consent_expiration_time: string | null
  update_type: string
  created_at?: string
}

export interface PlaidError {
  error_type: string
  error_code: string
  error_message: string
  display_message: string | null
  error_code_reason?: string | null
  request_id?: string
  status?: number | null
  documentation_url?: string
  suggested_action?: string | null
  required_account_subtypes?: string[]
  provided_account_subtypes?: string[]
}

export interface PlaidItemProductStatus {
  last_successful_update?: string | null
  last_failed_update?: string | null
}

export interface PlaidItemStatus {
  transactions?: PlaidItemProductStatus | null
  investments?: PlaidItemProductStatus | null
  last_webhook?: {
    sent_at?: string | null
    code_sent?: string
  } | null
}

export interface PlaidTransactionCategory {
  primary: string
  detailed: string
  confidence_level?: string | null
  version?: string
}

export interface PlaidTransactionLocation {
  address: string | null
  city: string | null
  region: string | null
  postal_code: string | null
  country: string | null
  lat: number | null
  lon: number | null
  store_number: string | null
}

export interface PlaidCounterparty {
  name: string
  type: string
  entity_id?: string | null
  website: string | null
  logo_url: string | null
  confidence_level?: string | null
}

/** Transaction returned by /transactions/sync. Field names mirror the Plaid API. */
export interface PlaidTransaction {
  transaction_id: string
  account_id: string
  amount: number
  iso_currency_code: string | null
  unofficial_currency_code: string | null
  date: string
  datetime: string | null
  authorized_date: string | null
  authorized_datetime: string | null
  name: string
  merchant_name?: string | null
  merchant_entity_id?: string | null
  logo_url?: string | null
  website?: string | null
  payment_channel: string
  pending: boolean
  pending_transaction_id: string | null
  personal_finance_category?: PlaidTransactionCategory | null
  location: PlaidTransactionLocation
  counterparties?: PlaidCounterparty[]
  transaction_code: string | null
  original_description?: string | null
}

export interface PlaidRemovedTransaction {
  transaction_id: string
  account_id: string
}

/** Institution returned by /institutions/search and /institutions/get_by_id. */
export interface PlaidInstitution {
  institution_id: string
  name: string
  products: string[]
  country_codes: string[]
  url?: string | null
  primary_color?: string | null
  routing_numbers: string[]
  oauth: boolean
}

export interface PlaidAccountBalances {
  available: number | null
  current: number | null
  limit: number | null
  iso_currency_code: string | null
  unofficial_currency_code: string | null
  last_updated_datetime?: string | null
}

/** Account returned by /accounts/get, /accounts/balance/get, /auth/get, and /identity/get. */
export interface PlaidAccount {
  account_id: string
  name: string
  official_name: string | null
  mask: string | null
  type: string
  subtype: string | null
  balances: PlaidAccountBalances
  verification_status?: string | null
  persistent_account_id?: string
  holder_category?: string | null
}

export interface PlaidOwnerContact {
  data: string
  primary: boolean
  type: string
}

export interface PlaidOwnerAddress {
  primary?: boolean
  data: {
    street: string
    city: string | null
    region: string | null
    postal_code: string | null
    country: string | null
  }
}

export interface PlaidIdentityOwner {
  names: string[]
  phone_numbers: PlaidOwnerContact[]
  emails: PlaidOwnerContact[]
  addresses: PlaidOwnerAddress[]
}

export interface PlaidIdentityAccount extends PlaidAccount {
  owners: PlaidIdentityOwner[]
}

export interface PlaidAchNumbers {
  account_id: string
  account: string
  routing: string
  wire_routing: string | null
  is_tokenized_account_number?: boolean
}

export interface PlaidEftNumbers {
  account_id: string
  account: string
  institution: string
  branch: string
}

export interface PlaidInternationalNumbers {
  account_id: string
  iban: string
  bic: string
}

export interface PlaidBacsNumbers {
  account_id: string
  account: string
  sort_code: string
}

/** Account/routing numbers returned by /auth/get, grouped by scheme. */
export interface PlaidNumbers {
  ach: PlaidAchNumbers[]
  eft: PlaidEftNumbers[]
  international: PlaidInternationalNumbers[]
  bacs: PlaidBacsNumbers[]
}

export interface PlaidSuccessOutput {
  requestId: string
}

export interface PlaidGetItemResponse extends ToolResponse {
  output: PlaidSuccessOutput & {
    item: PlaidItem
    status?: PlaidItemStatus | null
  }
}

export interface PlaidSyncTransactionsResponse extends ToolResponse {
  output: PlaidSuccessOutput & {
    added: PlaidTransaction[]
    modified: PlaidTransaction[]
    removed: PlaidRemovedTransaction[]
    nextCursor: string
    hasMore: boolean
    updateStatus: string
  }
}

export interface PlaidSearchInstitutionsResponse extends ToolResponse {
  output: PlaidSuccessOutput & {
    institutions: PlaidInstitution[]
    count: number
  }
}

export interface PlaidGetInstitutionResponse extends ToolResponse {
  output: PlaidSuccessOutput & {
    institution: PlaidInstitution
  }
}

export interface PlaidGetAccountsResponse extends ToolResponse {
  output: PlaidSuccessOutput & {
    accounts: PlaidAccount[]
    count: number
  }
}

export type PlaidGetBalancesResponse = PlaidGetAccountsResponse

export interface PlaidGetAuthResponse extends ToolResponse {
  output: PlaidSuccessOutput & {
    accounts: PlaidAccount[]
    numbers: PlaidNumbers
  }
}

export interface PlaidGetIdentityResponse extends ToolResponse {
  output: PlaidSuccessOutput & {
    accounts: PlaidIdentityAccount[]
    count: number
  }
}

export type PlaidResponse =
  | PlaidGetItemResponse
  | PlaidSyncTransactionsResponse
  | PlaidSearchInstitutionsResponse
  | PlaidGetInstitutionResponse
  | PlaidGetAccountsResponse
  | PlaidGetAuthResponse
  | PlaidGetIdentityResponse

export const PLAID_REQUEST_ID_OUTPUT_PROPERTY: ToolOutputProperty = {
  type: 'string',
  description: 'Unique Plaid request ID for troubleshooting and support',
}

export const PLAID_ERROR_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  error_type: { type: 'string', description: 'Broad Plaid error category' },
  error_code: { type: 'string', description: 'Programmatic Plaid error code' },
  error_message: { type: 'string', description: 'Developer-facing error message' },
  display_message: {
    type: 'string',
    description: 'User-facing error message',
    nullable: true,
  },
  error_code_reason: {
    type: 'string',
    description: 'More specific OAuth error reason, when available',
    optional: true,
    nullable: true,
  },
  request_id: {
    type: 'string',
    description: 'Plaid request ID for troubleshooting',
    optional: true,
  },
  status: {
    type: 'number',
    description: 'HTTP status associated with an error delivered by webhook',
    optional: true,
    nullable: true,
  },
  documentation_url: {
    type: 'string',
    description: 'Plaid documentation URL for this error',
    optional: true,
  },
  suggested_action: {
    type: 'string',
    description: 'Suggested steps for resolving the error',
    optional: true,
    nullable: true,
  },
  required_account_subtypes: {
    type: 'array',
    description: 'Account subtypes requested for the Item',
    optional: true,
    items: { type: 'string', description: 'Plaid account subtype' },
  },
  provided_account_subtypes: {
    type: 'array',
    description: 'Account subtypes found but not requested for the Item',
    optional: true,
    items: { type: 'string', description: 'Plaid account subtype' },
  },
}

export const PLAID_ITEM_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  item_id: { type: 'string', description: 'Unique ID of the Item' },
  institution_id: {
    type: 'string',
    description: 'Plaid institution ID the Item is linked to',
    optional: true,
    nullable: true,
  },
  institution_name: {
    type: 'string',
    description: 'Name of the linked institution',
    optional: true,
    nullable: true,
  },
  webhook: {
    type: 'string',
    description: 'Webhook URL set on the Item',
    nullable: true,
  },
  error: {
    type: 'object',
    description: 'Plaid error state for the Item, or null when healthy',
    nullable: true,
    properties: PLAID_ERROR_OUTPUT_PROPERTIES,
  },
  available_products: {
    type: 'array',
    description: 'Products available but not yet billed for the Item',
    items: { type: 'string', description: 'Plaid product name' },
  },
  billed_products: {
    type: 'array',
    description: 'Products the Item has been billed for',
    items: { type: 'string', description: 'Plaid product name' },
  },
  products: {
    type: 'array',
    description: 'All products added to the Item',
    optional: true,
    items: { type: 'string', description: 'Plaid product name' },
  },
  consent_expiration_time: {
    type: 'string',
    description: 'When access consent expires, if the institution enforces expiration',
    nullable: true,
  },
  update_type: {
    type: 'string',
    description: 'Item update type (background or user_present_required)',
  },
  created_at: {
    type: 'string',
    description: 'When the Item was created',
    optional: true,
  },
}

export const PLAID_ITEM_PRODUCT_STATUS_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  last_successful_update: {
    type: 'string',
    description: 'Timestamp of the last successful product update',
    optional: true,
    nullable: true,
  },
  last_failed_update: {
    type: 'string',
    description: 'Timestamp of the last failed product update',
    optional: true,
    nullable: true,
  },
}

export const PLAID_ITEM_STATUS_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  transactions: {
    type: 'object',
    description: 'Last successful and failed Transactions updates',
    optional: true,
    nullable: true,
    properties: PLAID_ITEM_PRODUCT_STATUS_OUTPUT_PROPERTIES,
  },
  investments: {
    type: 'object',
    description: 'Last successful and failed Investments updates',
    optional: true,
    nullable: true,
    properties: PLAID_ITEM_PRODUCT_STATUS_OUTPUT_PROPERTIES,
  },
  last_webhook: {
    type: 'object',
    description: 'The last webhook fired for the Item',
    optional: true,
    nullable: true,
    properties: {
      sent_at: {
        type: 'string',
        description: 'Timestamp when the webhook was fired',
        optional: true,
        nullable: true,
      },
      code_sent: {
        type: 'string',
        description: 'The last webhook code sent',
        optional: true,
      },
    },
  },
}

export const PLAID_ACCOUNT_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  account_id: { type: 'string', description: 'Unique Plaid account ID' },
  name: { type: 'string', description: 'Account name' },
  official_name: {
    type: 'string',
    description: 'Official account name from the institution',
    nullable: true,
  },
  mask: {
    type: 'string',
    description: 'Last 2-4 characters of the account number',
    nullable: true,
  },
  type: {
    type: 'string',
    description: 'Account type, including depository, credit, loan, investment, or brokerage',
  },
  subtype: {
    type: 'string',
    description: 'Account subtype, e.g. checking, savings, credit card',
    nullable: true,
  },
  balances: {
    type: 'object',
    description:
      'Balances with available, current, limit, and iso_currency_code fields (null where the institution does not report them)',
    properties: {
      available: {
        type: 'number',
        description: 'Funds available to spend or withdraw',
        nullable: true,
      },
      current: { type: 'number', description: 'Current balance', nullable: true },
      limit: { type: 'number', description: 'Credit limit', nullable: true },
      iso_currency_code: {
        type: 'string',
        description: 'ISO 4217 currency code',
        nullable: true,
      },
      unofficial_currency_code: {
        type: 'string',
        description: 'Unofficial currency code when ISO 4217 does not apply',
        nullable: true,
      },
      last_updated_datetime: {
        type: 'string',
        description: 'When the balance was last refreshed, when supplied by the institution',
        optional: true,
        nullable: true,
      },
    },
  },
  verification_status: {
    type: 'string',
    description:
      'Micro-deposit/database verification state; null or empty when neither verification method applies',
    optional: true,
    nullable: true,
  },
  persistent_account_id: {
    type: 'string',
    description: 'Persistent account identifier when Plaid can provide one',
    optional: true,
  },
  holder_category: {
    type: 'string',
    description: 'Whether the account holder is personal or business, when known',
    optional: true,
    nullable: true,
  },
}

export const PLAID_TRANSACTION_CATEGORY_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  primary: { type: 'string', description: 'High-level personal finance category' },
  detailed: { type: 'string', description: 'Granular personal finance category' },
  confidence_level: {
    type: 'string',
    description: 'Plaid confidence level for the categorization',
    optional: true,
    nullable: true,
  },
  version: {
    type: 'string',
    description: 'Personal finance category taxonomy version',
    optional: true,
  },
}

export const PLAID_TRANSACTION_LOCATION_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  address: { type: 'string', description: 'Street address', nullable: true },
  city: { type: 'string', description: 'City', nullable: true },
  region: { type: 'string', description: 'Region or state', nullable: true },
  postal_code: { type: 'string', description: 'Postal code', nullable: true },
  country: {
    type: 'string',
    description: 'ISO 3166-1 alpha-2 country code',
    nullable: true,
  },
  lat: { type: 'number', description: 'Latitude', nullable: true },
  lon: { type: 'number', description: 'Longitude', nullable: true },
  store_number: { type: 'string', description: 'Merchant store number', nullable: true },
}

export const PLAID_COUNTERPARTY_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  name: { type: 'string', description: 'Counterparty name' },
  type: { type: 'string', description: 'Counterparty type' },
  website: { type: 'string', description: 'Counterparty website', nullable: true },
  logo_url: { type: 'string', description: 'Counterparty logo URL', nullable: true },
  entity_id: {
    type: 'string',
    description: 'Stable Plaid counterparty entity ID',
    optional: true,
    nullable: true,
  },
  confidence_level: {
    type: 'string',
    description: 'Plaid confidence level for the counterparty match',
    optional: true,
    nullable: true,
  },
}

export const PLAID_TRANSACTION_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  transaction_id: { type: 'string', description: 'Unique ID of the transaction' },
  account_id: { type: 'string', description: 'ID of the account the transaction belongs to' },
  amount: {
    type: 'number',
    description: 'Settled value in account currency; positive values are debits (money out)',
  },
  iso_currency_code: {
    type: 'string',
    description: 'ISO 4217 currency code',
    nullable: true,
  },
  unofficial_currency_code: {
    type: 'string',
    description: 'Unofficial currency code when ISO 4217 does not apply',
    nullable: true,
  },
  date: { type: 'string', description: 'Posted date (YYYY-MM-DD)' },
  authorized_date: {
    type: 'string',
    description: 'Date the transaction was authorized (YYYY-MM-DD)',
    nullable: true,
  },
  authorized_datetime: {
    type: 'string',
    description: 'Date and time the transaction was authorized, when supplied by the institution',
    nullable: true,
  },
  datetime: {
    type: 'string',
    description: 'Posted date and time when supplied by the institution',
    nullable: true,
  },
  name: {
    type: 'string',
    description:
      'Plaid transaction name; use original_description for the unmodified institution text',
  },
  merchant_name: {
    type: 'string',
    description: 'Cleaned merchant name',
    optional: true,
    nullable: true,
  },
  merchant_entity_id: {
    type: 'string',
    description: 'Plaid merchant entity ID',
    optional: true,
    nullable: true,
  },
  logo_url: {
    type: 'string',
    description: 'Merchant logo URL',
    optional: true,
    nullable: true,
  },
  website: {
    type: 'string',
    description: 'Merchant website',
    optional: true,
    nullable: true,
  },
  payment_channel: {
    type: 'string',
    description: "Payment channel: 'online', 'in store', or 'other'",
  },
  pending: { type: 'boolean', description: 'Whether the transaction is pending' },
  pending_transaction_id: {
    type: 'string',
    description: 'Pending transaction replaced by this posted transaction',
    nullable: true,
  },
  personal_finance_category: {
    type: 'object',
    description: 'Categorization with primary, detailed, confidence_level, and version fields',
    optional: true,
    nullable: true,
    properties: PLAID_TRANSACTION_CATEGORY_OUTPUT_PROPERTIES,
  },
  location: {
    type: 'object',
    description: 'Where the transaction occurred (address, city, region, country, lat, lon)',
    properties: PLAID_TRANSACTION_LOCATION_OUTPUT_PROPERTIES,
  },
  counterparties: {
    type: 'array',
    description: 'Counterparties involved in the transaction, when supplied',
    optional: true,
    items: { type: 'object', properties: PLAID_COUNTERPARTY_OUTPUT_PROPERTIES },
  },
  transaction_code: {
    type: 'string',
    description: 'Institution transaction code',
    nullable: true,
  },
  original_description: {
    type: 'string',
    description:
      'Unmodified description from the institution (present when includeOriginalDescription is enabled)',
    optional: true,
    nullable: true,
  },
}

export const PLAID_OWNER_CONTACT_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  data: { type: 'string', description: 'Phone number or email address' },
  primary: { type: 'boolean', description: 'Whether this is the primary contact value' },
  type: { type: 'string', description: 'Contact value type' },
}

export const PLAID_OWNER_ADDRESS_DATA_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  street: { type: 'string', description: 'Full street address' },
  city: { type: 'string', description: 'City', nullable: true },
  region: { type: 'string', description: 'Region or state', nullable: true },
  postal_code: { type: 'string', description: 'Postal code', nullable: true },
  country: {
    type: 'string',
    description: 'ISO 3166-1 alpha-2 country code',
    nullable: true,
  },
}

export const PLAID_OWNER_ADDRESS_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  primary: {
    type: 'boolean',
    description: 'Whether this is the primary address',
    optional: true,
  },
  data: {
    type: 'object',
    description: 'Structured postal address',
    properties: PLAID_OWNER_ADDRESS_DATA_OUTPUT_PROPERTIES,
  },
}

export const PLAID_IDENTITY_OWNER_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  names: {
    type: 'array',
    description: 'Names associated with the account owner',
    items: { type: 'string', description: 'Owner name' },
  },
  phone_numbers: {
    type: 'array',
    description: 'Phone numbers associated with the account owner',
    items: { type: 'object', properties: PLAID_OWNER_CONTACT_OUTPUT_PROPERTIES },
  },
  emails: {
    type: 'array',
    description: 'Email addresses associated with the account owner',
    items: { type: 'object', properties: PLAID_OWNER_CONTACT_OUTPUT_PROPERTIES },
  },
  addresses: {
    type: 'array',
    description: 'Postal addresses associated with the account owner',
    items: { type: 'object', properties: PLAID_OWNER_ADDRESS_OUTPUT_PROPERTIES },
  },
}

export const PLAID_ACH_NUMBER_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  account_id: { type: 'string', description: 'Plaid account ID' },
  account: { type: 'string', description: 'ACH account number' },
  routing: { type: 'string', description: 'ACH routing number' },
  wire_routing: {
    type: 'string',
    description: 'Wire transfer routing number',
    nullable: true,
  },
  is_tokenized_account_number: {
    type: 'boolean',
    description: 'Whether the institution supplied a tokenized account number',
    optional: true,
  },
}

export const PLAID_EFT_NUMBER_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  account_id: { type: 'string', description: 'Plaid account ID' },
  account: { type: 'string', description: 'EFT account number' },
  institution: { type: 'string', description: 'EFT institution number' },
  branch: { type: 'string', description: 'EFT branch number' },
}

export const PLAID_INTERNATIONAL_NUMBER_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  account_id: { type: 'string', description: 'Plaid account ID' },
  iban: { type: 'string', description: 'International Bank Account Number (IBAN)' },
  bic: { type: 'string', description: 'Business Identifier Code (BIC)' },
}

export const PLAID_BACS_NUMBER_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  account_id: { type: 'string', description: 'Plaid account ID' },
  account: { type: 'string', description: 'Bacs account number' },
  sort_code: { type: 'string', description: 'Bacs sort code' },
}

export const PLAID_NUMBERS_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  ach: {
    type: 'array',
    description:
      'US account and routing numbers (tokenized numbers stop working if the Item is deleted)',
    items: { type: 'object', properties: PLAID_ACH_NUMBER_OUTPUT_PROPERTIES },
  },
  eft: {
    type: 'array',
    description: 'Canadian account, institution, and branch numbers',
    items: { type: 'object', properties: PLAID_EFT_NUMBER_OUTPUT_PROPERTIES },
  },
  international: {
    type: 'array',
    description: 'International IBAN and BIC values',
    items: { type: 'object', properties: PLAID_INTERNATIONAL_NUMBER_OUTPUT_PROPERTIES },
  },
  bacs: {
    type: 'array',
    description: 'UK account numbers and sort codes',
    items: { type: 'object', properties: PLAID_BACS_NUMBER_OUTPUT_PROPERTIES },
  },
}

export const PLAID_INSTITUTION_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  institution_id: { type: 'string', description: 'Unique Plaid institution ID' },
  name: { type: 'string', description: 'Institution name' },
  products: {
    type: 'array',
    description: 'Plaid products the institution supports',
    items: { type: 'string', description: 'Plaid product name' },
  },
  country_codes: {
    type: 'array',
    description: 'Countries the institution operates in',
    items: { type: 'string', description: 'ISO 3166-1 alpha-2 country code' },
  },
  url: {
    type: 'string',
    description: 'Institution website URL',
    optional: true,
    nullable: true,
  },
  primary_color: {
    type: 'string',
    description: 'Institution brand color (hex)',
    optional: true,
    nullable: true,
  },
  routing_numbers: {
    type: 'array',
    description: 'Known routing numbers for the institution',
    items: { type: 'string', description: 'Routing number' },
  },
  oauth: {
    type: 'boolean',
    description:
      'Whether some Items may require OAuth or the institution may be migrating to OAuth',
  },
}
