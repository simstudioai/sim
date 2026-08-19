import type { ToolResponse } from '@/tools/types'

/** Credential params shared by every Plaid tool. */
export interface PlaidBaseParams {
  oauthCredential: string
  /** Runtime-injected from the encrypted Plaid credential. */
  clientId?: string
  /** Runtime-injected from the encrypted Plaid credential. */
  secret?: string
  environment?: string
}

/** Params for tools that operate on a linked Item. */
export interface PlaidAccessTokenParams extends PlaidBaseParams {
  /** Runtime-injected from the encrypted Plaid credential. */
  accessToken?: string
}

export type PlaidGetItemParams = PlaidAccessTokenParams

export interface PlaidSyncTransactionsParams extends PlaidAccessTokenParams {
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

export interface PlaidGetAccountsParams extends PlaidAccessTokenParams {
  accountIds?: string
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
  error: Record<string, unknown> | null
  available_products: string[]
  billed_products: string[]
  products?: string[]
  consent_expiration_time: string | null
  update_type: string
  created_at?: string
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

export interface PlaidGetItemResponse extends ToolResponse {
  output: {
    item: PlaidItem
    status?: PlaidItemStatus | null
  }
}

export interface PlaidSyncTransactionsResponse extends ToolResponse {
  output: {
    added: PlaidTransaction[]
    modified: PlaidTransaction[]
    removed: PlaidRemovedTransaction[]
    nextCursor: string
    hasMore: boolean
    updateStatus: string
  }
}

export interface PlaidSearchInstitutionsResponse extends ToolResponse {
  output: {
    institutions: PlaidInstitution[]
    count: number
  }
}

export interface PlaidGetInstitutionResponse extends ToolResponse {
  output: {
    institution: PlaidInstitution
  }
}

export interface PlaidGetAccountsResponse extends ToolResponse {
  output: {
    accounts: PlaidAccount[]
    count: number
  }
}

export type PlaidGetBalancesResponse = PlaidGetAccountsResponse

export interface PlaidGetAuthResponse extends ToolResponse {
  output: {
    accounts: PlaidAccount[]
    numbers: PlaidNumbers
  }
}

export interface PlaidGetIdentityResponse extends ToolResponse {
  output: {
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
