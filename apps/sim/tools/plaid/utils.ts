import type { PlaidOperationBody } from '@/lib/api/contracts/tools/plaid'
import type {
  PlaidAccount,
  PlaidAccountBalances,
  PlaidCounterparty,
  PlaidError,
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

export const plaidCredentialParamFields = {
  plaidCredentialId: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'ID of a preconnected reusable Plaid Item credential',
  },
} as const

export const plaidBaseParamFields = plaidCredentialParamFields

type PlaidOperationInput<O extends PlaidOperationBody['operation']> = Extract<
  PlaidOperationBody,
  { operation: O }
>['input']

/** Builds the executor-delegated request without exposing Plaid application credentials. */
export function buildPlaidInternalBody<O extends PlaidOperationBody['operation']>(
  operation: O,
  params: { plaidCredentialId: unknown },
  input: PlaidOperationInput<O>
): Extract<PlaidOperationBody, { operation: O }> {
  return {
    operation,
    credentialId: requirePlaidInputString(params.plaidCredentialId, 'Plaid credential'),
    input,
  } as Extract<PlaidOperationBody, { operation: O }>
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
 * Normalizes a bounded selector array or advanced comma-separated list.
 */
export function splitPlaidList(
  value: unknown,
  fieldLabel = 'Plaid list',
  constraints: { maxCharacters?: number; maxItems?: number } = {}
): string[] | undefined {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return undefined
  const source = Array.isArray(value) ? value : [value]
  if (!source.every((item): item is string => typeof item === 'string')) {
    throw new Error(`${fieldLabel} must be a string or an array of strings`)
  }
  const maxCharacters = constraints.maxCharacters ?? 10_000
  const maxItems = constraints.maxItems ?? 500
  const characterCount = source.reduce((total, item) => total + item.length, 0)
  if (characterCount > maxCharacters) {
    throw new Error(`${fieldLabel} must be at most ${maxCharacters} characters`)
  }
  const items = source
    .flatMap((item) => item.split(','))
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

/** Parses bounded open-world Plaid product identifiers. */
export function parsePlaidProducts(value: unknown, fieldLabel: string): string[] | undefined {
  const products = splitPlaidList(value, fieldLabel, {
    maxCharacters: 5_000,
    maxItems: 50,
  })?.map((product) => product.toLowerCase())
  if (!products?.length) return undefined
  const invalid = products.find((product) => !/^[a-z][a-z0-9_]{0,63}$/.test(product))
  if (invalid) throw new Error(`${fieldLabel} contains an invalid Plaid product: ${invalid}`)
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

/** Validates and projects the documented Plaid error envelope. */
function mapPlaidError(value: unknown, path: string): PlaidError | null {
  if (value === null) return null
  const record = requireRecord(value, path)
  const mapped: PlaidError = {
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
  path: string,
  maxItems?: number
): unknown[] {
  const values = requireArray(record[key], path)
  if (maxItems !== undefined && values.length > maxItems) {
    throw new Error(`${path} must contain at most ${maxItems} items`)
  }
  return values
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
