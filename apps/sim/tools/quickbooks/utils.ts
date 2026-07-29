import { truncate } from '@sim/utils/string'
import type {
  QuickBooksEntityName,
  QuickBooksFault,
  QuickBooksQueryEnvelope,
  QuickBooksRecord,
} from '@/tools/quickbooks/types'

export const QUICKBOOKS_API_BASE = 'https://quickbooks.api.intuit.com'
export const QUICKBOOKS_MINOR_VERSION = '75'

const QUICKBOOKS_MAX_RESULTS_LIMIT = 1000
const QUICKBOOKS_METADATA_KEYS = new Set(['startPosition', 'maxResults', 'totalCount'])

export function buildQuickBooksHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

export function buildQuickBooksQueryEndpoint(params: {
  realmId: string
  minorVersion?: string
}): string {
  const realmId = params.realmId.trim()
  if (!realmId) {
    throw new Error('QuickBooks Company ID is required')
  }

  const url = new URL(`${QUICKBOOKS_API_BASE}/v3/company/${encodeURIComponent(realmId)}/query`)
  url.searchParams.set('minorversion', normalizeMinorVersion(params.minorVersion))
  return url.toString()
}

export function buildQuickBooksQueryUrl(params: {
  realmId: string
  query: string
  minorVersion?: string
}): string {
  const url = new URL(buildQuickBooksQueryEndpoint(params))
  url.searchParams.set('query', normalizeQuickBooksQuery(params.query))
  return url.toString()
}

export function normalizeQuickBooksQuery(query: string): string {
  const trimmed = query.trim()
  if (!trimmed) {
    throw new Error('QuickBooks query is required')
  }
  return trimmed
}

export function buildQuickBooksListQuery(
  entity: QuickBooksEntityName,
  params: { startPosition?: string; maxResults?: string; activeOnly?: boolean | string }
): string {
  const clauses = [`SELECT * FROM ${entity}`]

  if (entity === 'Vendor' && toBoolean(params.activeOnly)) {
    clauses.push('WHERE Active = true')
  }

  const startPosition = normalizePositiveInteger(params.startPosition, 'Start position')
  if (startPosition) {
    clauses.push(`STARTPOSITION ${startPosition}`)
  }

  const maxResults = normalizePositiveInteger(
    params.maxResults,
    'Max results',
    QUICKBOOKS_MAX_RESULTS_LIMIT
  )
  if (maxResults) {
    clauses.push(`MAXRESULTS ${maxResults}`)
  }

  return clauses.join(' ')
}

export async function parseQuickBooksJson(response: Response): Promise<QuickBooksQueryEnvelope> {
  const text = await response.text()
  let data: QuickBooksQueryEnvelope = {}

  if (text.trim()) {
    try {
      data = JSON.parse(text) as QuickBooksQueryEnvelope
    } catch {
      throw new Error(
        `QuickBooks API error (${response.status}): ${truncate(text.trim(), 500) || 'Invalid JSON response'}`
      )
    }
  }

  const faultMessage = extractQuickBooksError(data)
  if (!response.ok || faultMessage) {
    throw new Error(
      `QuickBooks API error (${response.status}): ${
        faultMessage || response.statusText || 'Request failed'
      }`
    )
  }

  return data
}

export function extractQuickBooksRecords(
  data: QuickBooksQueryEnvelope,
  preferredEntity?: QuickBooksEntityName
): { entity: string | null; items: QuickBooksRecord[] } {
  const queryResponse = data.QueryResponse ?? {}

  if (preferredEntity) {
    const records = queryResponse[preferredEntity]
    return {
      entity: preferredEntity,
      items: Array.isArray(records) ? normalizeRecords(records) : [],
    }
  }

  const entity = Object.keys(queryResponse).find((key) => {
    return !QUICKBOOKS_METADATA_KEYS.has(key) && Array.isArray(queryResponse[key])
  })

  if (!entity) {
    return { entity: null, items: [] }
  }

  return { entity, items: normalizeRecords(queryResponse[entity]) }
}

export function getQuickBooksQueryMetadata(data: QuickBooksQueryEnvelope): {
  totalCount: number | null
  startPosition: number | null
  maxResults: number | null
} {
  const queryResponse = data.QueryResponse ?? {}
  return {
    totalCount: typeof queryResponse.totalCount === 'number' ? queryResponse.totalCount : null,
    startPosition:
      typeof queryResponse.startPosition === 'number' ? queryResponse.startPosition : null,
    maxResults: typeof queryResponse.maxResults === 'number' ? queryResponse.maxResults : null,
  }
}

function normalizeMinorVersion(value?: string): string {
  const trimmed = value?.trim()
  return trimmed || QUICKBOOKS_MINOR_VERSION
}

function normalizePositiveInteger(
  value: string | undefined,
  fieldLabel: string,
  max?: number
): string | null {
  if (value == null || value.trim() === '') return null

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${fieldLabel} must be a positive integer`)
  }

  if (max !== undefined && parsed > max) {
    throw new Error(`${fieldLabel} must be ${max} or less`)
  }

  return String(parsed)
}

function toBoolean(value: boolean | string | undefined): boolean {
  if (typeof value === 'boolean') return value
  if (!value) return false
  return value.toLowerCase() === 'true'
}

function normalizeRecords(value: unknown): QuickBooksRecord[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is QuickBooksRecord => {
    return item != null && typeof item === 'object' && !Array.isArray(item)
  })
}

function extractQuickBooksError(data: QuickBooksQueryEnvelope): string | null {
  const errors = [
    ...extractFaultErrors(data.Fault),
    ...extractFaultErrors(data.QueryResponse?.Fault),
  ]
  const message = errors
    .map((error) => error.Detail || error.Message || error.code)
    .filter(Boolean)
    .join('; ')
  return message || null
}

function extractFaultErrors(
  fault: QuickBooksFault | undefined
): NonNullable<QuickBooksFault['Error']> {
  return Array.isArray(fault?.Error) ? fault.Error : []
}
