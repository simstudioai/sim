import type {
  PlaidAccount,
  PlaidAccountBalances,
  PlaidCounterparty,
  PlaidIdentityAccount,
  PlaidIdentityOwner,
  PlaidInstitution,
  PlaidItem,
  PlaidItemProductStatus,
  PlaidItemStatus,
  PlaidNumbers,
  PlaidOwnerAddress,
  PlaidOwnerContact,
  PlaidRemovedTransaction,
  PlaidTransaction,
  PlaidTransactionCategory,
  PlaidTransactionLocation,
} from '@/tools/plaid/types'
import type { ToolOutputProperty } from '@/tools/types'

export const PLAID_BASE_URLS = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
} as const

/** Pinned API version so response shapes stay stable across Plaid dashboard defaults. */
const PLAID_API_VERSION = '2020-09-14'

const PLAID_COUNTRY_CODES = new Set([
  'US',
  'GB',
  'ES',
  'NL',
  'FR',
  'IE',
  'CA',
  'DE',
  'IT',
  'PL',
  'DK',
  'NO',
  'SE',
  'EE',
  'LT',
  'LV',
  'PT',
  'BE',
  'AT',
  'FI',
])

const PLAID_PRODUCTS = new Set([
  'assets',
  'auth',
  'balance',
  'balance_plus',
  'beacon',
  'identity',
  'identity_match',
  'investments',
  'investments_auth',
  'liabilities',
  'payment_initiation',
  'identity_verification',
  'transactions',
  'credit_details',
  'income',
  'income_verification',
  'standing_orders',
  'transfer',
  'employment',
  'recurring_transactions',
  'transactions_refresh',
  'signal',
  'statements',
  'processor_payments',
  'processor_identity',
  'profile',
  'cra_base_report',
  'cra_income_insights',
  'cra_partner_insights',
  'cra_network_insights',
  'cra_cashflow_insights',
  'cra_monitoring',
  'cra_lend_score',
  'cra_plaid_credit_score',
  'cra_qualify',
  'cra_home_lending',
  'layer',
  'pay_by_bank',
  'protect_linked_bank',
  'protect_transactions',
])

/** Builds a Plaid URL from the two environments this integration supports. */
export function plaidUrl(params: { environment?: string }, path: string): string {
  const environment = params.environment?.trim().toLowerCase()
  if (environment && environment !== 'production' && environment !== 'sandbox') {
    throw new Error('Plaid environment must be production or sandbox')
  }
  const base = environment === 'sandbox' ? PLAID_BASE_URLS.sandbox : PLAID_BASE_URLS.production
  return `${base}${path}`
}

/**
 * Builds the standard headers for Plaid API requests. Credentials travel in the
 * PLAID-CLIENT-ID / PLAID-SECRET headers rather than the JSON body.
 */
export function buildPlaidHeaders(params: {
  clientId?: unknown
  secret?: unknown
}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'PLAID-CLIENT-ID': requirePlaidInputString(params.clientId, 'clientId'),
    'PLAID-SECRET': requirePlaidInputString(params.secret, 'secret'),
    'Plaid-Version': PLAID_API_VERSION,
  }
}

export const plaidCredentialParamFields = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Reusable encrypted Plaid Item credential',
  },
  clientId: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Plaid client ID injected from the selected credential at execution time',
  },
  secret: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Plaid API secret injected from the selected credential at execution time',
  },
} as const

export const plaidBaseParamFields = {
  ...plaidCredentialParamFields,
  environment: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Plaid environment injected from the selected credential at execution time',
  },
} as const

export const plaidAccessTokenParamField = {
  accessToken: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Plaid Item access token injected from the selected credential at execution time',
  },
} as const

/**
 * Drops undefined- and null-valued fields so optional params never reach the
 * wire as null. Nulls can arrive from LLM tool calls, which bypass the block's
 * subblock coercion entirely.
 */
export function plaidBody(fields: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) cleaned[key] = value
  }
  return cleaned
}

/**
 * Coerces an optional numeric request field to a finite number, throwing on
 * non-numeric input rather than sending it to Plaid. Guards the LLM tool-call
 * path, which never runs the block's subblock coercion.
 */
export function toPlaidOptionalNumber(
  value: unknown,
  fieldLabel: string,
  constraints: { integer?: boolean; min?: number; max?: number } = {}
): number | undefined {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return undefined
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error(`${fieldLabel} must be a valid number`)
  }
  const text = typeof value === 'string' ? value.trim() : undefined
  if (text !== undefined && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
    throw new Error(`${fieldLabel} must be a valid number`)
  }
  const parsed = typeof value === 'number' ? value : Number(text)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldLabel} must be a valid number`)
  }
  if (constraints.integer && !Number.isInteger(parsed)) {
    throw new Error(`${fieldLabel} must be a whole number`)
  }
  if (constraints.min !== undefined && parsed < constraints.min) {
    throw new Error(`${fieldLabel} must be at least ${constraints.min}`)
  }
  if (constraints.max !== undefined && parsed > constraints.max) {
    throw new Error(`${fieldLabel} must be at most ${constraints.max}`)
  }
  return parsed
}

/** Parses the only boolean forms accepted by direct and block tool calls. */
export function toPlaidOptionalBoolean(
  value: unknown,
  fieldLabel = 'includeOriginalDescription'
): boolean | undefined {
  if (value == null) return undefined
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  throw new Error(`${fieldLabel} must be true or false`)
}

/**
 * Splits a bounded comma-separated list into a trimmed, non-empty array. Tool
 * params declare these fields as strings, so arrays and objects are rejected at
 * the direct-call boundary instead of being expanded before request-size checks.
 */
export function splitPlaidList(
  value: unknown,
  fieldLabel = 'Plaid list',
  constraints: { maxCharacters?: number; maxItems?: number } = {}
): string[] | undefined {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return undefined
  if (typeof value !== 'string') {
    throw new Error(`${fieldLabel} must be a comma-separated string`)
  }
  const maxCharacters = constraints.maxCharacters ?? 10_000
  const maxItems = constraints.maxItems ?? 500
  if (value.length > maxCharacters) {
    throw new Error(`${fieldLabel} must be at most ${maxCharacters} characters`)
  }
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (items.length > maxItems) {
    throw new Error(`${fieldLabel} must contain at most ${maxItems} values`)
  }
  return items.length > 0 ? items : undefined
}

/** Parses and validates Plaid's closed request country-code enum. */
export function parsePlaidCountryCodes(value: unknown): string[] {
  const codes = (
    splitPlaidList(value, 'countryCodes', { maxCharacters: 1_000, maxItems: 20 }) ?? ['US']
  ).map((code) => code.toUpperCase())
  const invalid = codes.find((code) => !PLAID_COUNTRY_CODES.has(code))
  if (invalid) throw new Error(`countryCodes contains unsupported Plaid country code: ${invalid}`)
  return codes
}

/** Parses and validates Plaid's closed request product enum. */
export function parsePlaidProducts(
  value: unknown,
  fieldLabel: string,
  options: { required?: boolean; allowIncomeVerification?: boolean } = {}
): string[] | undefined {
  const products = splitPlaidList(value, fieldLabel, {
    maxCharacters: 5_000,
    maxItems: 50,
  })?.map((product) => product.toLowerCase())
  if (!products?.length) {
    if (options.required) throw new Error(`${fieldLabel} must contain at least one value`)
    return undefined
  }
  const invalid = products.find((product) => !PLAID_PRODUCTS.has(product))
  if (invalid) throw new Error(`${fieldLabel} contains unsupported Plaid product: ${invalid}`)
  if (!options.allowIncomeVerification && products.includes('income_verification')) {
    throw new Error(
      `${fieldLabel} cannot include income_verification because its required options are not supported`
    )
  }
  return products
}

/** Reads a required input string and applies wire-level length constraints. */
export function requirePlaidInputString(
  value: unknown,
  fieldLabel: string,
  constraints: { maxLength?: number } = {}
): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldLabel} is required`)
  }
  const trimmed = value.trim()
  if (constraints.maxLength !== undefined && trimmed.length > constraints.maxLength) {
    throw new Error(`${fieldLabel} must be at most ${constraints.maxLength} characters`)
  }
  return trimmed
}

/** Reads an optional input string without coercing arrays, objects, or booleans. */
export function toPlaidOptionalString(
  value: unknown,
  fieldLabel: string,
  constraints: { maxLength?: number } = {}
): string | undefined {
  if (value == null || (typeof value === 'string' && !value.trim())) return undefined
  if (typeof value !== 'string') throw new Error(`${fieldLabel} must be a string`)
  const trimmed = value.trim()
  if (constraints.maxLength !== undefined && trimmed.length > constraints.maxLength) {
    throw new Error(`${fieldLabel} must be at most ${constraints.maxLength} characters`)
  }
  return trimmed
}

/** Validates an optional RFC 3339 date-time input. */
export function toPlaidOptionalDateTime(value: unknown, fieldLabel: string): string | undefined {
  const text = toPlaidOptionalString(value, fieldLabel)
  if (text === undefined) return undefined
  const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
  if (!rfc3339.test(text) || Number.isNaN(Date.parse(text))) {
    throw new Error(`${fieldLabel} must be an ISO 8601 date-time with a timezone`)
  }
  return text
}

/** Validates an optional HTTP(S) webhook URL without normalizing its contents. */
export function toPlaidOptionalWebhookUrl(value: unknown): string | undefined {
  const text = toPlaidOptionalString(value, 'webhook')
  if (text === undefined) return undefined
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new Error('webhook must be a valid HTTP(S) URL')
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    throw new Error('webhook must be a valid HTTP(S) URL')
  }
  return text
}

/** Parses a Plaid success response body, rejecting non-object payloads. */
export async function plaidRecord(
  response: Response,
  label: string
): Promise<Record<string, unknown>> {
  const text = await response.text()
  let payload: unknown = null
  try {
    payload = text ? (JSON.parse(text) as unknown) : null
  } catch {
    throw new Error(`Plaid returned a response that was not valid JSON for ${label}`)
  }
  if (!isRecordLike(payload)) {
    throw new Error(`Plaid did not return a valid ${label} object`)
  }
  return payload
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(record, key)
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecordLike(value)) throw new Error(`${path} must be an object`)
  return value
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new Error(`${path} must be a string`)
  return value
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`)
  }
  return value
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`)
  return value
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  return value
}

function requireStringArray(value: unknown, path: string): string[] {
  const items = requireArray(value, path)
  if (!items.every((item): item is string => typeof item === 'string')) {
    throw new Error(`${path} must contain only strings`)
  }
  return items
}

function requireNullableString(value: unknown, path: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`${path} must be a string or null`)
  return value
}

function requireNullableNumber(value: unknown, path: string): number | null {
  if (value === null) return null
  return requireFiniteNumber(value, path)
}

function requireNullableRecord(value: unknown, path: string): Record<string, unknown> | null {
  if (value === null) return null
  if (!isRecordLike(value)) throw new Error(`${path} must be an object or null`)
  return value
}

/** Validates the documented Plaid error envelope while preserving additive provider fields. */
function mapPlaidError(value: unknown, path: string): Record<string, unknown> | null {
  if (value === null) return null
  const record = requireRecord(value, path)
  const mapped: Record<string, unknown> = {
    ...record,
    error_type: requireString(record.error_type, `${path}.error_type`),
    error_code: requireString(record.error_code, `${path}.error_code`),
    error_message: requireString(record.error_message, `${path}.error_message`),
    display_message: requireNullableString(record.display_message, `${path}.display_message`),
  }

  if (hasOwn(record, 'error_code_reason')) {
    mapped.error_code_reason = requireNullableString(
      record.error_code_reason,
      `${path}.error_code_reason`
    )
  }
  if (hasOwn(record, 'request_id')) {
    mapped.request_id = requireString(record.request_id, `${path}.request_id`)
  }
  if (hasOwn(record, 'causes')) mapped.causes = requireArray(record.causes, `${path}.causes`)
  if (hasOwn(record, 'status')) {
    const status = record.status
    if (status === null) {
      mapped.status = null
    } else {
      const parsedStatus = requireFiniteNumber(status, `${path}.status`)
      if (!Number.isInteger(parsedStatus))
        throw new Error(`${path}.status must be an integer or null`)
      mapped.status = parsedStatus
    }
  }
  if (hasOwn(record, 'documentation_url')) {
    mapped.documentation_url = requireString(record.documentation_url, `${path}.documentation_url`)
  }
  if (hasOwn(record, 'suggested_action')) {
    mapped.suggested_action = requireNullableString(
      record.suggested_action,
      `${path}.suggested_action`
    )
  }
  if (hasOwn(record, 'required_account_subtypes')) {
    mapped.required_account_subtypes = requireStringArray(
      record.required_account_subtypes,
      `${path}.required_account_subtypes`
    )
  }
  if (hasOwn(record, 'provided_account_subtypes')) {
    mapped.provided_account_subtypes = requireStringArray(
      record.provided_account_subtypes,
      `${path}.provided_account_subtypes`
    )
  }
  return mapped
}

/** Reads an array field whose requiredness is guaranteed by Plaid's success schema. */
export function requirePlaidArrayField(
  record: Record<string, unknown>,
  key: string,
  path: string
): unknown[] {
  return requireArray(record[key], path)
}

/** Reads a string field whose requiredness is guaranteed by Plaid's success schema. */
export function requirePlaidStringField(
  record: Record<string, unknown>,
  key: string,
  path: string
): string {
  return requireString(record[key], path)
}

/** Reads a boolean field whose requiredness is guaranteed by Plaid's success schema. */
export function requirePlaidBooleanField(
  record: Record<string, unknown>,
  key: string,
  path: string
): boolean {
  return requireBoolean(record[key], path)
}

function mapProductStatus(value: unknown, path: string): PlaidItemProductStatus | null {
  if (value === null) return null
  const record = requireRecord(value, path)
  return {
    ...(hasOwn(record, 'last_successful_update')
      ? {
          last_successful_update: requireNullableString(
            record.last_successful_update,
            `${path}.last_successful_update`
          ),
        }
      : {}),
    ...(hasOwn(record, 'last_failed_update')
      ? {
          last_failed_update: requireNullableString(
            record.last_failed_update,
            `${path}.last_failed_update`
          ),
        }
      : {}),
  }
}

export function mapPlaidItem(value: unknown): PlaidItem {
  const record = requireRecord(value, 'item')
  return {
    item_id: requireString(record.item_id, 'item.item_id'),
    ...(hasOwn(record, 'institution_id')
      ? { institution_id: requireNullableString(record.institution_id, 'item.institution_id') }
      : {}),
    ...(hasOwn(record, 'institution_name')
      ? {
          institution_name: requireNullableString(record.institution_name, 'item.institution_name'),
        }
      : {}),
    webhook: requireNullableString(record.webhook, 'item.webhook'),
    error: mapPlaidError(record.error, 'item.error'),
    available_products: requireStringArray(record.available_products, 'item.available_products'),
    billed_products: requireStringArray(record.billed_products, 'item.billed_products'),
    ...(hasOwn(record, 'products')
      ? { products: requireStringArray(record.products, 'item.products') }
      : {}),
    consent_expiration_time: requireNullableString(
      record.consent_expiration_time,
      'item.consent_expiration_time'
    ),
    update_type: requireString(record.update_type, 'item.update_type'),
    ...(hasOwn(record, 'created_at')
      ? { created_at: requireString(record.created_at, 'item.created_at') }
      : {}),
  }
}

export function mapPlaidItemStatus(value: unknown): PlaidItemStatus | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const record = requireRecord(value, 'status')
  const lastWebhook = hasOwn(record, 'last_webhook')
    ? record.last_webhook === null
      ? null
      : requireRecord(record.last_webhook, 'status.last_webhook')
    : undefined
  return {
    ...(hasOwn(record, 'transactions')
      ? { transactions: mapProductStatus(record.transactions, 'status.transactions') }
      : {}),
    ...(hasOwn(record, 'investments')
      ? { investments: mapProductStatus(record.investments, 'status.investments') }
      : {}),
    ...(lastWebhook === undefined
      ? {}
      : {
          last_webhook:
            lastWebhook === null
              ? null
              : {
                  ...(hasOwn(lastWebhook, 'sent_at')
                    ? {
                        sent_at: requireNullableString(
                          lastWebhook.sent_at,
                          'status.last_webhook.sent_at'
                        ),
                      }
                    : {}),
                  ...(hasOwn(lastWebhook, 'code_sent')
                    ? {
                        code_sent: requireString(
                          lastWebhook.code_sent,
                          'status.last_webhook.code_sent'
                        ),
                      }
                    : {}),
                },
        }),
  }
}

function mapTransactionCategory(value: unknown, path: string): PlaidTransactionCategory | null {
  if (value === null) return null
  const record = requireRecord(value, path)
  return {
    primary: requireString(record.primary, `${path}.primary`),
    detailed: requireString(record.detailed, `${path}.detailed`),
    ...(hasOwn(record, 'confidence_level')
      ? {
          confidence_level: requireNullableString(
            record.confidence_level,
            `${path}.confidence_level`
          ),
        }
      : {}),
    ...(hasOwn(record, 'version')
      ? { version: requireString(record.version, `${path}.version`) }
      : {}),
  }
}

function mapTransactionLocation(value: unknown, path: string): PlaidTransactionLocation {
  const record = requireRecord(value, path)
  return {
    address: requireNullableString(record.address, `${path}.address`),
    city: requireNullableString(record.city, `${path}.city`),
    region: requireNullableString(record.region, `${path}.region`),
    postal_code: requireNullableString(record.postal_code, `${path}.postal_code`),
    country: requireNullableString(record.country, `${path}.country`),
    lat: requireNullableNumber(record.lat, `${path}.lat`),
    lon: requireNullableNumber(record.lon, `${path}.lon`),
    store_number: requireNullableString(record.store_number, `${path}.store_number`),
  }
}

function mapCounterparty(value: unknown, path: string): PlaidCounterparty {
  const record = requireRecord(value, path)
  return {
    name: requireString(record.name, `${path}.name`),
    type: requireString(record.type, `${path}.type`),
    website: requireNullableString(record.website, `${path}.website`),
    logo_url: requireNullableString(record.logo_url, `${path}.logo_url`),
    ...(hasOwn(record, 'entity_id')
      ? { entity_id: requireNullableString(record.entity_id, `${path}.entity_id`) }
      : {}),
    ...(hasOwn(record, 'confidence_level')
      ? {
          confidence_level: requireNullableString(
            record.confidence_level,
            `${path}.confidence_level`
          ),
        }
      : {}),
  }
}

export function mapPlaidTransaction(value: unknown, path = 'transaction'): PlaidTransaction {
  const record = requireRecord(value, path)
  return {
    transaction_id: requireString(record.transaction_id, `${path}.transaction_id`),
    account_id: requireString(record.account_id, `${path}.account_id`),
    amount: requireFiniteNumber(record.amount, `${path}.amount`),
    iso_currency_code: requireNullableString(record.iso_currency_code, `${path}.iso_currency_code`),
    unofficial_currency_code: requireNullableString(
      record.unofficial_currency_code,
      `${path}.unofficial_currency_code`
    ),
    date: requireString(record.date, `${path}.date`),
    datetime: requireNullableString(record.datetime, `${path}.datetime`),
    authorized_date: requireNullableString(record.authorized_date, `${path}.authorized_date`),
    authorized_datetime: requireNullableString(
      record.authorized_datetime,
      `${path}.authorized_datetime`
    ),
    name: requireString(record.name, `${path}.name`),
    ...(hasOwn(record, 'merchant_name')
      ? { merchant_name: requireNullableString(record.merchant_name, `${path}.merchant_name`) }
      : {}),
    ...(hasOwn(record, 'merchant_entity_id')
      ? {
          merchant_entity_id: requireNullableString(
            record.merchant_entity_id,
            `${path}.merchant_entity_id`
          ),
        }
      : {}),
    ...(hasOwn(record, 'logo_url')
      ? { logo_url: requireNullableString(record.logo_url, `${path}.logo_url`) }
      : {}),
    ...(hasOwn(record, 'website')
      ? { website: requireNullableString(record.website, `${path}.website`) }
      : {}),
    payment_channel: requireString(record.payment_channel, `${path}.payment_channel`),
    pending: requireBoolean(record.pending, `${path}.pending`),
    pending_transaction_id: requireNullableString(
      record.pending_transaction_id,
      `${path}.pending_transaction_id`
    ),
    ...(hasOwn(record, 'personal_finance_category')
      ? {
          personal_finance_category: mapTransactionCategory(
            record.personal_finance_category,
            `${path}.personal_finance_category`
          ),
        }
      : {}),
    location: mapTransactionLocation(record.location, `${path}.location`),
    ...(hasOwn(record, 'counterparties')
      ? {
          counterparties: requireArray(record.counterparties, `${path}.counterparties`).map(
            (entry, index) => mapCounterparty(entry, `${path}.counterparties[${index}]`)
          ),
        }
      : {}),
    transaction_code: requireNullableString(record.transaction_code, `${path}.transaction_code`),
    ...(hasOwn(record, 'original_description')
      ? {
          original_description: requireNullableString(
            record.original_description,
            `${path}.original_description`
          ),
        }
      : {}),
  }
}

export function mapPlaidRemovedTransaction(
  value: unknown,
  path = 'removed transaction'
): PlaidRemovedTransaction {
  const record = requireRecord(value, path)
  return {
    transaction_id: requireString(record.transaction_id, `${path}.transaction_id`),
    account_id: requireString(record.account_id, `${path}.account_id`),
  }
}

/** Maps an institution, deliberately dropping the base64 `logo` payload to keep outputs small. */
export function mapPlaidInstitution(value: unknown, path = 'institution'): PlaidInstitution {
  const record = requireRecord(value, path)
  return {
    institution_id: requireString(record.institution_id, `${path}.institution_id`),
    name: requireString(record.name, `${path}.name`),
    products: requireStringArray(record.products, `${path}.products`),
    country_codes: requireStringArray(record.country_codes, `${path}.country_codes`),
    ...(hasOwn(record, 'url') ? { url: requireNullableString(record.url, `${path}.url`) } : {}),
    ...(hasOwn(record, 'primary_color')
      ? { primary_color: requireNullableString(record.primary_color, `${path}.primary_color`) }
      : {}),
    routing_numbers: requireStringArray(record.routing_numbers, `${path}.routing_numbers`),
    oauth: requireBoolean(record.oauth, `${path}.oauth`),
  }
}

function mapAccountBalances(value: unknown, path: string): PlaidAccountBalances {
  const record = requireRecord(value, path)
  return {
    available: requireNullableNumber(record.available, `${path}.available`),
    current: requireNullableNumber(record.current, `${path}.current`),
    limit: requireNullableNumber(record.limit, `${path}.limit`),
    iso_currency_code: requireNullableString(record.iso_currency_code, `${path}.iso_currency_code`),
    unofficial_currency_code: requireNullableString(
      record.unofficial_currency_code,
      `${path}.unofficial_currency_code`
    ),
    ...(hasOwn(record, 'last_updated_datetime')
      ? {
          last_updated_datetime: requireNullableString(
            record.last_updated_datetime,
            `${path}.last_updated_datetime`
          ),
        }
      : {}),
  }
}

export function mapPlaidAccount(value: unknown, path = 'account'): PlaidAccount {
  const record = requireRecord(value, path)
  const verificationStatus = hasOwn(record, 'verification_status')
    ? requireNullableString(record.verification_status, `${path}.verification_status`) || null
    : undefined
  return {
    account_id: requireString(record.account_id, `${path}.account_id`),
    name: requireString(record.name, `${path}.name`),
    official_name: requireNullableString(record.official_name, `${path}.official_name`),
    mask: requireNullableString(record.mask, `${path}.mask`),
    type: requireString(record.type, `${path}.type`),
    subtype: requireNullableString(record.subtype, `${path}.subtype`),
    balances: mapAccountBalances(record.balances, `${path}.balances`),
    ...(verificationStatus !== undefined ? { verification_status: verificationStatus } : {}),
    ...(hasOwn(record, 'persistent_account_id')
      ? {
          persistent_account_id: requireString(
            record.persistent_account_id,
            `${path}.persistent_account_id`
          ),
        }
      : {}),
    ...(hasOwn(record, 'holder_category')
      ? {
          holder_category: requireNullableString(record.holder_category, `${path}.holder_category`),
        }
      : {}),
  }
}

function mapOwnerContact(value: unknown, path: string): PlaidOwnerContact {
  const record = requireRecord(value, path)
  return {
    data: requireString(record.data, `${path}.data`),
    primary: requireBoolean(record.primary, `${path}.primary`),
    type: requireString(record.type, `${path}.type`),
  }
}

function mapOwnerAddress(value: unknown, path: string): PlaidOwnerAddress {
  const record = requireRecord(value, path)
  const data = requireRecord(record.data, `${path}.data`)
  return {
    ...(hasOwn(record, 'primary')
      ? { primary: requireBoolean(record.primary, `${path}.primary`) }
      : {}),
    data: {
      street: requireString(data.street, `${path}.data.street`),
      city: requireNullableString(data.city, `${path}.data.city`),
      region: requireNullableString(data.region, `${path}.data.region`),
      postal_code: requireNullableString(data.postal_code, `${path}.data.postal_code`),
      country: requireNullableString(data.country, `${path}.data.country`),
    },
  }
}

function mapIdentityOwner(value: unknown, path: string): PlaidIdentityOwner {
  const record = requireRecord(value, path)
  return {
    names: requireStringArray(record.names, `${path}.names`),
    phone_numbers: requireArray(record.phone_numbers, `${path}.phone_numbers`).map((entry, index) =>
      mapOwnerContact(entry, `${path}.phone_numbers[${index}]`)
    ),
    emails: requireArray(record.emails, `${path}.emails`).map((entry, index) =>
      mapOwnerContact(entry, `${path}.emails[${index}]`)
    ),
    addresses: requireArray(record.addresses, `${path}.addresses`).map((entry, index) =>
      mapOwnerAddress(entry, `${path}.addresses[${index}]`)
    ),
  }
}

export function mapPlaidIdentityAccount(
  value: unknown,
  path = 'identity account'
): PlaidIdentityAccount {
  const record = requireRecord(value, path)
  return {
    ...mapPlaidAccount(value, path),
    owners: requireArray(record.owners, `${path}.owners`).map((owner, index) =>
      mapIdentityOwner(owner, `${path}.owners[${index}]`)
    ),
  }
}

export function mapPlaidNumbers(value: unknown, path = 'auth.numbers'): PlaidNumbers {
  const record = requireRecord(value, path)
  const ach = requireArray(record.ach, `${path}.ach`)
  const eft = requireArray(record.eft, `${path}.eft`)
  const international = requireArray(record.international, `${path}.international`)
  const bacs = requireArray(record.bacs, `${path}.bacs`)
  return {
    ach: ach.map((entry, index) => {
      const entryPath = `${path}.ach[${index}]`
      const item = requireRecord(entry, entryPath)
      return {
        account_id: requireString(item.account_id, `${entryPath}.account_id`),
        account: requireString(item.account, `${entryPath}.account`),
        routing: requireString(item.routing, `${entryPath}.routing`),
        wire_routing: requireNullableString(item.wire_routing, `${entryPath}.wire_routing`),
        ...(hasOwn(item, 'is_tokenized_account_number')
          ? {
              is_tokenized_account_number: requireBoolean(
                item.is_tokenized_account_number,
                `${entryPath}.is_tokenized_account_number`
              ),
            }
          : {}),
      }
    }),
    eft: eft.map((entry, index) => {
      const entryPath = `${path}.eft[${index}]`
      const item = requireRecord(entry, entryPath)
      return {
        account_id: requireString(item.account_id, `${entryPath}.account_id`),
        account: requireString(item.account, `${entryPath}.account`),
        institution: requireString(item.institution, `${entryPath}.institution`),
        branch: requireString(item.branch, `${entryPath}.branch`),
      }
    }),
    international: international.map((entry, index) => {
      const entryPath = `${path}.international[${index}]`
      const item = requireRecord(entry, entryPath)
      return {
        account_id: requireString(item.account_id, `${entryPath}.account_id`),
        iban: requireString(item.iban, `${entryPath}.iban`),
        bic: requireString(item.bic, `${entryPath}.bic`),
      }
    }),
    bacs: bacs.map((entry, index) => {
      const entryPath = `${path}.bacs[${index}]`
      const item = requireRecord(entry, entryPath)
      return {
        account_id: requireString(item.account_id, `${entryPath}.account_id`),
        account: requireString(item.account, `${entryPath}.account`),
        sort_code: requireString(item.sort_code, `${entryPath}.sort_code`),
      }
    }),
  }
}

const plaidErrorOutputProperties: Record<string, ToolOutputProperty> = {
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
  causes: {
    type: 'array',
    description: 'Per-Item errors that caused this aggregate error',
    optional: true,
    items: { type: 'json', description: 'Provider error cause' },
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

export const plaidItemOutputProperties: Record<string, ToolOutputProperty> = {
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
    properties: plaidErrorOutputProperties,
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

const plaidItemProductStatusOutputProperties: Record<string, ToolOutputProperty> = {
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

export const plaidItemStatusOutputProperties: Record<string, ToolOutputProperty> = {
  transactions: {
    type: 'object',
    description: 'Last successful and failed Transactions updates',
    optional: true,
    nullable: true,
    properties: plaidItemProductStatusOutputProperties,
  },
  investments: {
    type: 'object',
    description: 'Last successful and failed Investments updates',
    optional: true,
    nullable: true,
    properties: plaidItemProductStatusOutputProperties,
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

export const plaidAccountOutputProperties: Record<string, ToolOutputProperty> = {
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

const plaidTransactionCategoryOutputProperties: Record<string, ToolOutputProperty> = {
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

const plaidTransactionLocationOutputProperties: Record<string, ToolOutputProperty> = {
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

const plaidCounterpartyOutputProperties: Record<string, ToolOutputProperty> = {
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

export const plaidTransactionOutputProperties: Record<string, ToolOutputProperty> = {
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
    properties: plaidTransactionCategoryOutputProperties,
  },
  location: {
    type: 'object',
    description: 'Where the transaction occurred (address, city, region, country, lat, lon)',
    properties: plaidTransactionLocationOutputProperties,
  },
  counterparties: {
    type: 'array',
    description: 'Counterparties involved in the transaction, when supplied',
    optional: true,
    items: { type: 'object', properties: plaidCounterpartyOutputProperties },
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

const plaidOwnerContactOutputProperties: Record<string, ToolOutputProperty> = {
  data: { type: 'string', description: 'Phone number or email address' },
  primary: { type: 'boolean', description: 'Whether this is the primary contact value' },
  type: { type: 'string', description: 'Contact value type' },
}

const plaidOwnerAddressDataOutputProperties: Record<string, ToolOutputProperty> = {
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

const plaidOwnerAddressOutputProperties: Record<string, ToolOutputProperty> = {
  primary: {
    type: 'boolean',
    description: 'Whether this is the primary address',
    optional: true,
  },
  data: {
    type: 'object',
    description: 'Structured postal address',
    properties: plaidOwnerAddressDataOutputProperties,
  },
}

export const plaidIdentityOwnerOutputProperties: Record<string, ToolOutputProperty> = {
  names: {
    type: 'array',
    description: 'Names associated with the account owner',
    items: { type: 'string', description: 'Owner name' },
  },
  phone_numbers: {
    type: 'array',
    description: 'Phone numbers associated with the account owner',
    items: { type: 'object', properties: plaidOwnerContactOutputProperties },
  },
  emails: {
    type: 'array',
    description: 'Email addresses associated with the account owner',
    items: { type: 'object', properties: plaidOwnerContactOutputProperties },
  },
  addresses: {
    type: 'array',
    description: 'Postal addresses associated with the account owner',
    items: { type: 'object', properties: plaidOwnerAddressOutputProperties },
  },
}

const plaidAchNumberOutputProperties: Record<string, ToolOutputProperty> = {
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

const plaidEftNumberOutputProperties: Record<string, ToolOutputProperty> = {
  account_id: { type: 'string', description: 'Plaid account ID' },
  account: { type: 'string', description: 'EFT account number' },
  institution: { type: 'string', description: 'EFT institution number' },
  branch: { type: 'string', description: 'EFT branch number' },
}

const plaidInternationalNumberOutputProperties: Record<string, ToolOutputProperty> = {
  account_id: { type: 'string', description: 'Plaid account ID' },
  iban: { type: 'string', description: 'International Bank Account Number (IBAN)' },
  bic: { type: 'string', description: 'Business Identifier Code (BIC)' },
}

const plaidBacsNumberOutputProperties: Record<string, ToolOutputProperty> = {
  account_id: { type: 'string', description: 'Plaid account ID' },
  account: { type: 'string', description: 'Bacs account number' },
  sort_code: { type: 'string', description: 'Bacs sort code' },
}

export const plaidNumbersOutputProperties: Record<string, ToolOutputProperty> = {
  ach: {
    type: 'array',
    description:
      'US account and routing numbers (tokenized numbers stop working if the Item is deleted)',
    items: { type: 'object', properties: plaidAchNumberOutputProperties },
  },
  eft: {
    type: 'array',
    description: 'Canadian account, institution, and branch numbers',
    items: { type: 'object', properties: plaidEftNumberOutputProperties },
  },
  international: {
    type: 'array',
    description: 'International IBAN and BIC values',
    items: { type: 'object', properties: plaidInternationalNumberOutputProperties },
  },
  bacs: {
    type: 'array',
    description: 'UK account numbers and sort codes',
    items: { type: 'object', properties: plaidBacsNumberOutputProperties },
  },
}

export const plaidInstitutionOutputProperties: Record<string, ToolOutputProperty> = {
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
  oauth: { type: 'boolean', description: 'Whether the institution uses an OAuth login flow' },
}
