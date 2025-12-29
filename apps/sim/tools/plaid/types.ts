import type { ToolResponse } from '@/tools/types'

/**
 * Plaid environment types
 */
export type PlaidEnvironment = 'sandbox' | 'development' | 'production'

/**
 * Plaid account types
 */
export type PlaidAccountType = 'depository' | 'credit' | 'loan' | 'investment' | 'other'

export type PlaidAccountSubtype =
  | 'checking'
  | 'savings'
  | 'money market'
  | 'cd'
  | 'credit card'
  | 'paypal'
  | '401k'
  | 'student'
  | 'mortgage'

/**
 * Plaid products
 */
export type PlaidProduct =
  | 'transactions'
  | 'auth'
  | 'identity'
  | 'assets'
  | 'investments'
  | 'liabilities'
  | 'payment_initiation'
  | 'identity_verification'
  | 'standing_orders'
  | 'transfer'
  | 'employment'
  | 'income_verification'
  | 'deposit_switch'
  | 'balance'

/**
 * Plaid country codes
 */
export type PlaidCountryCode = 'US' | 'CA' | 'GB' | 'FR' | 'ES' | 'NL' | 'DE' | 'IE' | 'IT' | 'PL'

/**
 * Link Token Types
 */
export interface CreateLinkTokenParams {
  clientId: string
  secret: string
  clientName: string
  language?: string
  countryCodes: PlaidCountryCode[]
  products: PlaidProduct[]
  user: {
    client_user_id: string
    email_address?: string
    phone_number?: string
  }
  redirectUri?: string
  webhook?: string
  accountFilters?: Record<string, any>
}

export interface LinkTokenObject {
  link_token: string
  expiration: string
  request_id: string
}

export interface LinkTokenResponse extends ToolResponse {
  output: {
    linkToken: LinkTokenObject
    metadata: {
      expiration: string
      created: boolean
    }
  }
}

/**
 * Access Token Types
 */
export interface ExchangePublicTokenParams {
  clientId: string
  secret: string
  publicToken: string
}

export interface AccessTokenObject {
  access_token: string
  item_id: string
  request_id: string
}

export interface AccessTokenResponse extends ToolResponse {
  output: {
    accessToken: AccessTokenObject
    metadata: {
      item_id: string
      success: boolean
    }
  }
}

/**
 * Account Types
 */
export interface PlaidAccount {
  account_id: string
  balances: {
    available: number | null
    current: number | null
    limit: number | null
    iso_currency_code: string | null
    unofficial_currency_code: string | null
  }
  mask: string | null
  name: string
  official_name: string | null
  type: PlaidAccountType
  subtype: PlaidAccountSubtype | null
  verification_status?: string
}

export interface GetAccountsParams {
  clientId: string
  secret: string
  accessToken: string
  accountIds?: string[]
}

export interface GetAccountsResponse extends ToolResponse {
  output: {
    accounts: PlaidAccount[]
    item: {
      item_id: string
      institution_id: string
      webhook: string | null
      error: any | null
      available_products: PlaidProduct[]
      billed_products: PlaidProduct[]
    }
    metadata: {
      count: number
      item_id: string
    }
  }
}

/**
 * Balance Types
 */
export interface GetBalanceParams {
  clientId: string
  secret: string
  accessToken: string
  accountIds?: string[]
}

export interface GetBalanceResponse extends ToolResponse {
  output: {
    accounts: PlaidAccount[]
    metadata: {
      count: number
      total_available: number
      total_current: number
    }
  }
}

/**
 * Transaction Types
 */
export interface PlaidTransaction {
  transaction_id: string
  account_id: string
  amount: number
  iso_currency_code: string | null
  unofficial_currency_code: string | null
  category: string[] | null
  category_id: string | null
  date: string
  authorized_date: string | null
  name: string
  merchant_name: string | null
  payment_channel: 'online' | 'in store' | 'other'
  pending: boolean
  pending_transaction_id: string | null
  account_owner: string | null
  location: {
    address: string | null
    city: string | null
    region: string | null
    postal_code: string | null
    country: string | null
    lat: number | null
    lon: number | null
    store_number: string | null
  }
  payment_meta: {
    reference_number: string | null
    ppd_id: string | null
    payee: string | null
    by_order_of: string | null
    payer: string | null
    payment_method: string | null
    payment_processor: string | null
    reason: string | null
  }
  transaction_type: 'place' | 'digital' | 'special' | 'unresolved'
  personal_finance_category?: {
    primary: string
    detailed: string
    confidence_level: string
  }
}

export interface GetTransactionsParams {
  clientId: string
  secret: string
  accessToken: string
  startDate: string
  endDate: string
  accountIds?: string[]
  count?: number
  offset?: number
}

export interface GetTransactionsResponse extends ToolResponse {
  output: {
    transactions: PlaidTransaction[]
    accounts: PlaidAccount[]
    total_transactions: number
    metadata: {
      count: number
      total_transactions: number
      startDate: string
      endDate: string
    }
  }
}

/**
 * Identity Types
 */
export interface PlaidIdentity {
  account_id: string
  owners: Array<{
    names: string[]
    phone_numbers: Array<{
      data: string
      primary: boolean
      type: 'home' | 'work' | 'mobile' | 'fax' | 'other'
    }>
    emails: Array<{
      data: string
      primary: boolean
      type: 'primary' | 'secondary' | 'other'
    }>
    addresses: Array<{
      data: {
        street: string
        city: string
        region: string
        postal_code: string
        country: string
      }
      primary: boolean
    }>
  }>
}

export interface GetIdentityParams {
  clientId: string
  secret: string
  accessToken: string
  accountIds?: string[]
}

export interface GetIdentityResponse extends ToolResponse {
  output: {
    accounts: PlaidIdentity[]
    metadata: {
      count: number
    }
  }
}

/**
 * Auth Types (Bank account and routing numbers)
 */
export interface PlaidAuthNumbers {
  account_id: string
  account: string
  routing: string
  wire_routing: string | null
}

export interface GetAuthParams {
  clientId: string
  secret: string
  accessToken: string
  accountIds?: string[]
}

export interface GetAuthResponse extends ToolResponse {
  output: {
    accounts: PlaidAccount[]
    numbers: {
      ach: PlaidAuthNumbers[]
      eft: any[]
      international: any[]
      bacs: any[]
    }
    metadata: {
      count: number
    }
  }
}

/**
 * Item Types
 */
export interface GetItemParams {
  clientId: string
  secret: string
  accessToken: string
}

export interface ItemObject {
  item_id: string
  institution_id: string
  webhook: string | null
  error: any | null
  available_products: PlaidProduct[]
  billed_products: PlaidProduct[]
  consent_expiration_time: string | null
  update_type: string
}

export interface GetItemResponse extends ToolResponse {
  output: {
    item: ItemObject
    status: {
      transactions: {
        last_successful_update: string | null
        last_failed_update: string | null
      }
      investments: {
        last_successful_update: string | null
        last_failed_update: string | null
      }
    }
    metadata: {
      item_id: string
      institution_id: string
    }
  }
}

/**
 * Institution Types
 */
export interface InstitutionObject {
  institution_id: string
  name: string
  products: PlaidProduct[]
  country_codes: PlaidCountryCode[]
  url: string | null
  primary_color: string | null
  logo: string | null
  routing_numbers: string[]
  oauth: boolean
  status: {
    item_logins: {
      status: string
      last_status_change: string
      breakdown: Record<string, any>
    }
    transactions_updates: {
      status: string
      last_status_change: string
    }
    auth: {
      status: string
      last_status_change: string
    }
    identity: {
      status: string
      last_status_change: string
    }
    balance: {
      status: string
      last_status_change: string
    }
  }
}

export interface GetInstitutionParams {
  clientId: string
  secret: string
  institutionId: string
  countryCodes: PlaidCountryCode[]
}

export interface GetInstitutionResponse extends ToolResponse {
  output: {
    institution: InstitutionObject
    metadata: {
      institution_id: string
      name: string
    }
  }
}

/**
 * Webhook Types
 */
export interface UpdateWebhookParams {
  clientId: string
  secret: string
  accessToken: string
  webhook: string
}

/**
 * AI Categorization Types
 */
export interface CategorizeTransactionsParams {
  apiKey: string
  apiSecret: string
  accessToken: string
  transactions: PlaidTransaction[]
  historicalCategories?: Array<{
    merchant: string
    category: string
    subcategory?: string
  }>
  useAI?: boolean
}

export interface CategorizeTransactionsResponse extends ToolResponse {
  output: {
    categorized_transactions: Array<{
      transaction_id: string
      merchant_name: string | null
      amount: number
      date: string
      original_category: string[] | null
      suggested_category: string
      suggested_subcategory: string
      confidence: number
    }>
    metadata: {
      total_transactions: number
      avg_confidence: number
    }
  }
}

/**
 * Recurring Transaction Detection Types
 */
export interface DetectRecurringParams {
  apiKey: string
  apiSecret: string
  accessToken: string
  transactions: PlaidTransaction[]
  minOccurrences?: number
  toleranceDays?: number
  amountTolerance?: number
}

export interface DetectRecurringResponse extends ToolResponse {
  output: {
    recurring_subscriptions: Array<{
      merchant_name: string
      frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly'
      avg_interval_days: number
      avg_amount: number
      occurrences: number
      first_transaction: string
      last_transaction: string
      next_predicted_date: string
      confidence: number
      transaction_ids: string[]
    }>
    metadata: {
      total_subscriptions_found: number
      total_transactions_analyzed: number
      date_range: {
        from: string
        to: string
      }
    }
  }
}
