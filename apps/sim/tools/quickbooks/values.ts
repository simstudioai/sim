import type {
  QuickBooksActiveStatus,
  QuickBooksAddress,
  QuickBooksItem,
  QuickBooksReference,
  QuickBooksWritableItemType,
} from '@/tools/quickbooks/types'

/**
 * Pure QuickBooks value normalizers and validators.
 *
 * This module has no runtime dependencies — no `fetch`, no environment
 * access, no response parsing — so it stays safe to import from the block
 * definition, which is client-bundled. Anything that needs the API client or
 * a `Response` belongs in `@/tools/quickbooks/utils` instead.
 */

export function requiredQuickBooksString(value: string, fieldName: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${fieldName} is required`)
  return normalized
}

export function optionalQuickBooksString(value?: string): string | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim()
  return normalized || undefined
}

export function quickBooksReference(value: string, fieldName: string): QuickBooksReference {
  return { value: requiredQuickBooksString(value, fieldName) }
}

const QUICKBOOKS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function validateQuickBooksDate(
  value: string | undefined,
  fieldName: string
): string | undefined {
  const normalized = optionalQuickBooksString(value)
  if (!normalized) return undefined
  if (!QUICKBOOKS_DATE_PATTERN.test(normalized)) {
    throw new Error(`${fieldName} must use YYYY-MM-DD`)
  }
  const date = new Date(`${normalized}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new Error(`${fieldName} must be a valid date`)
  }
  return normalized
}

/**
 * Maximum length Intuit documents for an email address: "maximum of 100 chars".
 */
const QUICKBOOKS_EMAIL_MAX_LENGTH = 100

/**
 * Accepts only an address Intuit can store: "An email address. The address
 * format must follow the RFC 822 standard." A single `@` with a non-empty,
 * whitespace-free local part and domain is the part of RFC 822 that can be
 * checked without rejecting addresses Intuit accepts, so nothing stricter is
 * enforced here.
 */
export function quickBooksEmailAddress(value?: string): { Address: string } | undefined {
  const normalized = optionalQuickBooksString(value)
  if (!normalized) return undefined
  if (normalized.length > QUICKBOOKS_EMAIL_MAX_LENGTH) {
    throw new Error(`Email address cannot exceed ${QUICKBOOKS_EMAIL_MAX_LENGTH} characters`)
  }
  const [localPart, domain, ...extra] = normalized.split('@')
  if (extra.length > 0 || !localPart || !domain || /\s/.test(normalized)) {
    throw new Error('Email address must be a valid address such as name@example.com')
  }
  return { Address: normalized }
}

export function quickBooksPhoneNumber(value?: string): { FreeFormNumber: string } | undefined {
  const normalized = optionalQuickBooksString(value)
  return normalized ? { FreeFormNumber: normalized } : undefined
}

export function validateQuickBooksOptionalNumber(
  value: number | undefined,
  fieldName: string
): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value)) throw new Error(`${fieldName} must be a finite number`)
  return value
}

/**
 * Intuit: "The maximum number of entities that can be returned in a response is
 * 1,000. If the result size isn't specified, the default number is 100."
 */
export const QUICKBOOKS_MAX_RESULTS = 1000

export function validateQuickBooksPagination(
  startPosition: number,
  maxResults: number
): { startPosition: number; maxResults: number } {
  if (!Number.isInteger(startPosition) || startPosition < 1) {
    throw new Error('startPosition must be a positive integer')
  }
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > QUICKBOOKS_MAX_RESULTS) {
    throw new Error(`maxResults must be an integer from 1 through ${QUICKBOOKS_MAX_RESULTS}`)
  }
  return { startPosition, maxResults }
}

export function assertQuickBooksListOnlyFilters(
  readMode: 'list' | 'by_id',
  filters: Record<string, unknown>
): void {
  if (readMode !== 'by_id') return
  const provided = Object.entries(filters).find(([, value]) => {
    if (value === undefined || value === null || value === '') return false
    return value !== 'default'
  })
  if (provided) throw new Error(`${provided[0]} is supported only for List mode`)
}

/**
 * Maximum length Intuit documents for `DisplayName` on Customer, Vendor, and
 * Employee: "maximum of 500 chars".
 */
const QUICKBOOKS_DISPLAY_NAME_MAX_LENGTH = 500

/**
 * Validates a `DisplayName` locally so an over-long value fails before it costs
 * a round trip. Uniqueness across Customer, Vendor, and Employee is documented
 * too, but only Intuit can decide it, so that stays a remote error.
 */
export function quickBooksDisplayName(
  value: string | undefined,
  fieldName: string
): string | undefined {
  const normalized = optionalQuickBooksString(value)
  if (normalized !== undefined && normalized.length > QUICKBOOKS_DISPLAY_NAME_MAX_LENGTH) {
    throw new Error(`${fieldName} cannot exceed ${QUICKBOOKS_DISPLAY_NAME_MAX_LENGTH} characters`)
  }
  return normalized
}

/** Maximum length Intuit documents for `Item.Name`: "Maximum of 100 chars". */
const QUICKBOOKS_ITEM_NAME_MAX_LENGTH = 100

/**
 * Applies Intuit's documented `Item.Name` rule: "This value must be unique, at
 * least one character in length, and cannot include tabs, new lines, or
 * colons." Uniqueness is left to Intuit.
 */
export function quickBooksItemName(value: string | undefined): string | undefined {
  const normalized = optionalQuickBooksString(value)
  if (normalized === undefined) return undefined
  if (normalized.length > QUICKBOOKS_ITEM_NAME_MAX_LENGTH) {
    throw new Error(`name cannot exceed ${QUICKBOOKS_ITEM_NAME_MAX_LENGTH} characters`)
  }
  if (/[\t\n\r:]/.test(normalized)) {
    throw new Error('name cannot include tabs, new lines, or colons')
  }
  return normalized
}

/**
 * Refuses the item updates Intuit documents as unsafe or unsupported.
 *
 * A full update echoes the record read back from QuickBooks, and for an
 * `Inventory` item that record carries `InvStartDate` and `QtyOnHand`. Intuit:
 * "For read operations, the date returned in this field is always the
 * originally provided inventory start date. For update operations, the date
 * supplied is interpreted as the inventory adjust date, is stored as such in
 * the underlying data model, and is reflected in the QuickBooks Online UI."
 * Both fields are also "Required for Inventory type items", so neither can be
 * dropped from the body: an inventory item has no safe full update from here,
 * and creating one is already unsupported.
 *
 * Intuit also documents inactivation — "achieved by setting the Active
 * attribute to false in an object update request" — as "Not valid for Category
 * item types".
 */
export function assertQuickBooksItemUpdatable(
  current: Record<string, unknown>,
  patch: Record<string, unknown>
): void {
  const itemType: QuickBooksItem['Type'] =
    typeof current.Type === 'string' ? current.Type : undefined
  if (itemType === 'Inventory') {
    throw new Error(
      'QuickBooks Inventory items cannot be updated here: the update would be recorded as an inventory adjustment. Edit inventory items in QuickBooks Online.'
    )
  }
  if (itemType === 'Category' && 'Active' in patch) {
    throw new Error('QuickBooks does not support the Active attribute on Category item types')
  }
}

export function quickBooksWritableItemType(itemType: QuickBooksWritableItemType): string {
  const types: Record<QuickBooksWritableItemType, string> = {
    service: 'Service',
    non_inventory: 'NonInventory',
  }
  const type = types[itemType]
  if (!type) throw new Error(`Unsupported writable QuickBooks item type: ${String(itemType)}`)
  return type
}

const QUICKBOOKS_ADDRESS_FIELDS = {
  line1: 'Line1',
  Line1: 'Line1',
  line2: 'Line2',
  Line2: 'Line2',
  line3: 'Line3',
  Line3: 'Line3',
  line4: 'Line4',
  Line4: 'Line4',
  line5: 'Line5',
  Line5: 'Line5',
  city: 'City',
  City: 'City',
  countrySubDivisionCode: 'CountrySubDivisionCode',
  CountrySubDivisionCode: 'CountrySubDivisionCode',
  postalCode: 'PostalCode',
  PostalCode: 'PostalCode',
  country: 'Country',
  Country: 'Country',
} as const

export function parseQuickBooksAddress(
  value: unknown,
  fieldName: string
): QuickBooksAddress | undefined {
  if (value == null || value === '') return undefined
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error(`${fieldName} must be valid JSON`)
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON object`)
  }

  const result: QuickBooksAddress = {}
  for (const [key, fieldValue] of Object.entries(parsed)) {
    const quickBooksKey = QUICKBOOKS_ADDRESS_FIELDS[key as keyof typeof QUICKBOOKS_ADDRESS_FIELDS]
    if (!quickBooksKey) {
      throw new Error(`${fieldName} contains unsupported field "${key}"`)
    }
    if (typeof fieldValue !== 'string') {
      throw new Error(`${fieldName}.${key} must be a string`)
    }
    result[quickBooksKey] = fieldValue
  }
  if (Object.keys(result).length === 0) {
    throw new Error(`${fieldName} must contain at least one supported address field`)
  }
  return result
}

export function quickBooksActiveValue(
  activeStatus: QuickBooksActiveStatus | undefined
): boolean | undefined {
  if (activeStatus === undefined || activeStatus === 'unchanged') return undefined
  if (activeStatus === 'active') return true
  if (activeStatus === 'inactive') return false
  throw new Error(`Unsupported QuickBooks active status: ${String(activeStatus)}`)
}

/**
 * Guards a QuickBooks sparse-update body.
 *
 * Enforces both halves of the contract:
 * 1. `sparse` is literally `true`. Intuit treats an update without it as a
 *    *full* replacement, silently clearing every field the body omits, and
 *    documents `sparse` as required to void an object. A builder that drops it
 *    would otherwise fail only against the live API.
 * 2. The body carries at least one field beyond the required identifiers
 *    (`Id`, `SyncToken`, `sparse` by default), so an update that would change
 *    nothing never reaches the API.
 */
export function assertQuickBooksSparseUpdate(
  body: Record<string, unknown>,
  requiredFieldCount = 3
): void {
  if (body.sparse !== true) {
    throw new Error('QuickBooks sparse update body must set sparse to true')
  }
  if (Object.keys(body).length <= requiredFieldCount) {
    throw new Error('Provide at least one field to update')
  }
}
