import type {
  QuickBooksActiveStatus,
  QuickBooksAddress,
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

export function quickBooksEmailAddress(value?: string): { Address: string } | undefined {
  const normalized = optionalQuickBooksString(value)
  return normalized ? { Address: normalized } : undefined
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

export function validateQuickBooksPagination(
  startPosition: number,
  maxResults: number
): { startPosition: number; maxResults: number } {
  if (!Number.isInteger(startPosition) || startPosition < 1) {
    throw new Error('startPosition must be a positive integer')
  }
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 100) {
    throw new Error('maxResults must be an integer from 1 through 100')
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
