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

/**
 * Builds the URL for a Plaid endpoint, selecting the environment host.
 * Defaults to production; anything other than 'sandbox' is treated as production.
 */
export function plaidUrl(params: { environment?: string }, path: string): string {
  const base =
    params.environment?.trim().toLowerCase() === 'sandbox'
      ? PLAID_BASE_URLS.sandbox
      : PLAID_BASE_URLS.production
  return `${base}${path}`
}

/**
 * Builds the standard headers for Plaid API requests. Credentials travel in the
 * PLAID-CLIENT-ID / PLAID-SECRET headers rather than the JSON body.
 */
export function buildPlaidHeaders(params: {
  clientId: string
  secret: string
}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'PLAID-CLIENT-ID': params.clientId.trim(),
    'PLAID-SECRET': params.secret.trim(),
    'Plaid-Version': PLAID_API_VERSION,
  }
}

export const plaidCredentialParamFields = {
  clientId: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Plaid client ID (from the Plaid Dashboard under Team Settings → Keys)',
  },
  secret: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Plaid API secret for the selected environment',
  },
} as const

export const plaidBaseParamFields = {
  ...plaidCredentialParamFields,
  environment: {
    type: 'string',
    required: false,
    visibility: 'user-only',
    description: "Plaid environment: 'production' (default) or 'sandbox'",
  },
} as const

export const plaidAccessTokenParamField = {
  accessToken: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Access token for the linked Item (from Exchange Public Token)',
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
export function toPlaidOptionalNumber(value: unknown, fieldLabel: string): number | undefined {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldLabel} must be a valid number`)
  }
  return parsed
}

/** Normalizes an optional boolean request field that may arrive as a string from LLM tool calls. */
export function toPlaidOptionalBoolean(value: unknown): boolean | undefined {
  if (value == null) return undefined
  if (typeof value === 'boolean') return value
  return String(value).trim().toLowerCase() === 'true'
}

/**
 * Splits a comma-separated list into a trimmed, non-empty array. Tolerates an
 * array arriving from an LLM tool call in place of the declared string.
 */
export function splitPlaidList(value?: string | readonly unknown[]): string[] | undefined {
  if (!value) return undefined
  const source = Array.isArray(value) ? value.map(String).join(',') : String(value)
  const items = source
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length > 0 ? items : undefined
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

function toRecordOrNull(value: unknown): Record<string, unknown> | null {
  return isRecordLike(value) ? value : null
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function toStringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toBoolean(value: unknown): boolean {
  return value === true
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function mapProductStatus(value: unknown): PlaidItemProductStatus | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    last_successful_update: toStringOrNull(record.last_successful_update),
    last_failed_update: toStringOrNull(record.last_failed_update),
  }
}

export function mapPlaidItem(value: unknown): PlaidItem {
  const record = toRecordOrNull(value) ?? {}
  return {
    item_id: toStringOrEmpty(record.item_id),
    institution_id: toStringOrNull(record.institution_id),
    institution_name: toStringOrNull(record.institution_name),
    webhook: toStringOrNull(record.webhook),
    error: toRecordOrNull(record.error),
    available_products: toStringArray(record.available_products),
    billed_products: toStringArray(record.billed_products),
    products: toStringArray(record.products),
    consent_expiration_time: toStringOrNull(record.consent_expiration_time),
    update_type: toStringOrEmpty(record.update_type),
    created_at: toStringOrEmpty(record.created_at),
  }
}

export function mapPlaidItemStatus(value: unknown): PlaidItemStatus | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  const lastWebhook = toRecordOrNull(record.last_webhook)
  return {
    transactions: mapProductStatus(record.transactions),
    investments: mapProductStatus(record.investments),
    last_webhook: lastWebhook
      ? {
          sent_at: toStringOrNull(lastWebhook.sent_at),
          code_sent: toStringOrNull(lastWebhook.code_sent),
        }
      : null,
  }
}

function mapTransactionCategory(value: unknown): PlaidTransactionCategory | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    primary: toStringOrNull(record.primary),
    detailed: toStringOrNull(record.detailed),
    confidence_level: toStringOrNull(record.confidence_level),
  }
}

function mapTransactionLocation(value: unknown): PlaidTransactionLocation | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    address: toStringOrNull(record.address),
    city: toStringOrNull(record.city),
    region: toStringOrNull(record.region),
    postal_code: toStringOrNull(record.postal_code),
    country: toStringOrNull(record.country),
    lat: toNumberOrNull(record.lat),
    lon: toNumberOrNull(record.lon),
    store_number: toStringOrNull(record.store_number),
  }
}

function mapCounterparty(value: unknown): PlaidCounterparty {
  const record = toRecordOrNull(value) ?? {}
  return {
    name: toStringOrNull(record.name),
    type: toStringOrNull(record.type),
    entity_id: toStringOrNull(record.entity_id),
    website: toStringOrNull(record.website),
    logo_url: toStringOrNull(record.logo_url),
    confidence_level: toStringOrNull(record.confidence_level),
  }
}

export function mapPlaidTransaction(value: unknown): PlaidTransaction {
  const record = toRecordOrNull(value) ?? {}
  const counterparties = Array.isArray(record.counterparties) ? record.counterparties : []
  return {
    transaction_id: toStringOrEmpty(record.transaction_id),
    account_id: toStringOrEmpty(record.account_id),
    amount: toNumberOrNull(record.amount) ?? 0,
    iso_currency_code: toStringOrNull(record.iso_currency_code),
    unofficial_currency_code: toStringOrNull(record.unofficial_currency_code),
    date: toStringOrEmpty(record.date),
    datetime: toStringOrNull(record.datetime),
    authorized_date: toStringOrNull(record.authorized_date),
    name: toStringOrEmpty(record.name),
    merchant_name: toStringOrNull(record.merchant_name),
    merchant_entity_id: toStringOrNull(record.merchant_entity_id),
    logo_url: toStringOrNull(record.logo_url),
    website: toStringOrNull(record.website),
    payment_channel: toStringOrEmpty(record.payment_channel),
    pending: toBoolean(record.pending),
    pending_transaction_id: toStringOrNull(record.pending_transaction_id),
    personal_finance_category: mapTransactionCategory(record.personal_finance_category),
    location: mapTransactionLocation(record.location),
    counterparties: counterparties.map(mapCounterparty),
    transaction_code: toStringOrNull(record.transaction_code),
    original_description: toStringOrNull(record.original_description),
  }
}

export function mapPlaidRemovedTransaction(value: unknown): PlaidRemovedTransaction {
  const record = toRecordOrNull(value) ?? {}
  return {
    transaction_id: toStringOrEmpty(record.transaction_id),
    account_id: toStringOrEmpty(record.account_id),
  }
}

/** Maps an institution, deliberately dropping the base64 `logo` payload to keep outputs small. */
export function mapPlaidInstitution(value: unknown): PlaidInstitution {
  const record = toRecordOrNull(value) ?? {}
  return {
    institution_id: toStringOrEmpty(record.institution_id),
    name: toStringOrEmpty(record.name),
    products: toStringArray(record.products),
    country_codes: toStringArray(record.country_codes),
    url: toStringOrNull(record.url),
    primary_color: toStringOrNull(record.primary_color),
    routing_numbers: toStringArray(record.routing_numbers),
    oauth: toBoolean(record.oauth),
  }
}

function mapAccountBalances(value: unknown): PlaidAccountBalances {
  const record = toRecordOrNull(value) ?? {}
  return {
    available: toNumberOrNull(record.available),
    current: toNumberOrNull(record.current),
    limit: toNumberOrNull(record.limit),
    iso_currency_code: toStringOrNull(record.iso_currency_code),
    unofficial_currency_code: toStringOrNull(record.unofficial_currency_code),
  }
}

export function mapPlaidAccount(value: unknown): PlaidAccount {
  const record = toRecordOrNull(value) ?? {}
  return {
    account_id: toStringOrEmpty(record.account_id),
    name: toStringOrEmpty(record.name),
    official_name: toStringOrNull(record.official_name),
    mask: toStringOrNull(record.mask),
    type: toStringOrEmpty(record.type),
    subtype: toStringOrNull(record.subtype),
    balances: mapAccountBalances(record.balances),
    verification_status: toStringOrNull(record.verification_status) || null,
    persistent_account_id: toStringOrNull(record.persistent_account_id),
    holder_category: toStringOrNull(record.holder_category),
  }
}

function mapOwnerContact(value: unknown): PlaidOwnerContact {
  const record = toRecordOrNull(value) ?? {}
  return {
    data: toStringOrEmpty(record.data),
    primary: toBoolean(record.primary),
    type: toStringOrEmpty(record.type),
  }
}

function mapOwnerAddress(value: unknown): PlaidOwnerAddress {
  const record = toRecordOrNull(value) ?? {}
  const data = toRecordOrNull(record.data) ?? {}
  return {
    primary: toBoolean(record.primary),
    data: {
      street: toStringOrEmpty(data.street),
      city: toStringOrNull(data.city),
      region: toStringOrNull(data.region),
      postal_code: toStringOrNull(data.postal_code),
      country: toStringOrNull(data.country),
    },
  }
}

function mapIdentityOwner(value: unknown): PlaidIdentityOwner {
  const record = toRecordOrNull(value) ?? {}
  const phones = Array.isArray(record.phone_numbers) ? record.phone_numbers : []
  const emails = Array.isArray(record.emails) ? record.emails : []
  const addresses = Array.isArray(record.addresses) ? record.addresses : []
  return {
    names: toStringArray(record.names),
    phone_numbers: phones.map(mapOwnerContact),
    emails: emails.map(mapOwnerContact),
    addresses: addresses.map(mapOwnerAddress),
  }
}

export function mapPlaidIdentityAccount(value: unknown): PlaidIdentityAccount {
  const record = toRecordOrNull(value) ?? {}
  const owners = Array.isArray(record.owners) ? record.owners : []
  return {
    ...mapPlaidAccount(value),
    owners: owners.map(mapIdentityOwner),
  }
}

export function mapPlaidNumbers(value: unknown): PlaidNumbers {
  const record = toRecordOrNull(value) ?? {}
  const ach = Array.isArray(record.ach) ? record.ach : []
  const eft = Array.isArray(record.eft) ? record.eft : []
  const international = Array.isArray(record.international) ? record.international : []
  const bacs = Array.isArray(record.bacs) ? record.bacs : []
  return {
    ach: ach.map((entry) => {
      const item = toRecordOrNull(entry) ?? {}
      return {
        account_id: toStringOrEmpty(item.account_id),
        account: toStringOrEmpty(item.account),
        routing: toStringOrEmpty(item.routing),
        wire_routing: toStringOrNull(item.wire_routing),
        is_tokenized_account_number:
          typeof item.is_tokenized_account_number === 'boolean'
            ? item.is_tokenized_account_number
            : null,
      }
    }),
    eft: eft.map((entry) => {
      const item = toRecordOrNull(entry) ?? {}
      return {
        account_id: toStringOrEmpty(item.account_id),
        account: toStringOrEmpty(item.account),
        institution: toStringOrEmpty(item.institution),
        branch: toStringOrEmpty(item.branch),
      }
    }),
    international: international.map((entry) => {
      const item = toRecordOrNull(entry) ?? {}
      return {
        account_id: toStringOrEmpty(item.account_id),
        iban: toStringOrEmpty(item.iban),
        bic: toStringOrEmpty(item.bic),
      }
    }),
    bacs: bacs.map((entry) => {
      const item = toRecordOrNull(entry) ?? {}
      return {
        account_id: toStringOrEmpty(item.account_id),
        account: toStringOrEmpty(item.account),
        sort_code: toStringOrEmpty(item.sort_code),
      }
    }),
  }
}

export const plaidAccountOutputProperties: Record<string, ToolOutputProperty> = {
  account_id: { type: 'string', description: 'Unique Plaid account ID' },
  name: { type: 'string', description: 'Account name' },
  official_name: {
    type: 'string',
    description: 'Official account name from the institution',
    optional: true,
  },
  mask: {
    type: 'string',
    description: 'Last 2-4 characters of the account number',
    optional: true,
  },
  type: {
    type: 'string',
    description: 'Account type: depository, credit, loan, investment, or other',
  },
  subtype: {
    type: 'string',
    description: 'Account subtype, e.g. checking, savings, credit card',
    optional: true,
  },
  balances: {
    type: 'json',
    description:
      'Balances with available, current, limit, and iso_currency_code fields (null where the institution does not report them)',
  },
  verification_status: {
    type: 'string',
    description:
      'Micro-deposit/database verification state (e.g. automatically_verified, verification_failed); null for instantly authenticated accounts',
    optional: true,
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
    optional: true,
  },
  date: { type: 'string', description: 'Posted date (YYYY-MM-DD)' },
  authorized_date: {
    type: 'string',
    description: 'Date the transaction was authorized (YYYY-MM-DD)',
    optional: true,
  },
  name: { type: 'string', description: 'Raw transaction description from the institution' },
  merchant_name: {
    type: 'string',
    description: 'Cleaned merchant name',
    optional: true,
  },
  payment_channel: {
    type: 'string',
    description: "Payment channel: 'online', 'in store', or 'other'",
  },
  pending: { type: 'boolean', description: 'Whether the transaction is pending' },
  personal_finance_category: {
    type: 'json',
    description: 'Categorization with primary, detailed, and confidence_level fields',
    optional: true,
  },
  location: {
    type: 'json',
    description: 'Where the transaction occurred (address, city, region, country, lat, lon)',
    optional: true,
  },
  original_description: {
    type: 'string',
    description:
      'Unmodified description from the institution (present when includeOriginalDescription is enabled)',
    optional: true,
  },
}

export const plaidInstitutionOutputProperties: Record<string, ToolOutputProperty> = {
  institution_id: { type: 'string', description: 'Unique Plaid institution ID' },
  name: { type: 'string', description: 'Institution name' },
  products: { type: 'json', description: 'Plaid products the institution supports' },
  country_codes: { type: 'json', description: 'Countries the institution operates in' },
  url: { type: 'string', description: 'Institution website URL', optional: true },
  primary_color: { type: 'string', description: 'Institution brand color (hex)', optional: true },
  routing_numbers: { type: 'json', description: 'Known routing numbers for the institution' },
  oauth: { type: 'boolean', description: 'Whether the institution uses an OAuth login flow' },
}
