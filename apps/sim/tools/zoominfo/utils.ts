import { getErrorMessage } from '@sim/utils/errors'
import type { OutputProperty } from '@/tools/types'
import type { ZoomInfoBaseParams } from '@/tools/zoominfo/types'

export const ZOOMINFO_PROXY_URL = '/api/tools/zoominfo/proxy'

export interface ZoomInfoProxyEnvelope {
  clientId: string
  clientSecret: string
  path: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  query?: Record<string, string | number | boolean>
  body?: unknown
}

export function buildProxyBody(
  params: ZoomInfoBaseParams
): Pick<ZoomInfoProxyEnvelope, 'clientId' | 'clientSecret'> {
  return {
    clientId: params.clientId,
    clientSecret: params.clientSecret,
  }
}

export function parseJsonField<T>(value: unknown, fieldName: string): T {
  if (typeof value !== 'string') return value as T
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${fieldName} is required`)
  }
  try {
    return JSON.parse(trimmed) as T
  } catch (error) {
    throw new Error(`${fieldName} must be valid JSON: ${getErrorMessage(error)}`)
  }
}

/**
 * Normalize a JSON-array string, real array, or comma-separated string into a
 * single comma-separated string. Use for ZoomInfo attributes that the docs
 * describe as a scalar string accepting a comma-separated list
 * (e.g. industryCodes, managementLevel, department).
 */
export function toCsvStringOrUndefined(value: unknown, fieldName: string): string | undefined {
  const arr = parseCsvOrJson(value, fieldName)
  if (!arr || arr.length === 0) return undefined
  return arr.join(',')
}

export function parseCsvOrJson(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) return value.map(String)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (!Array.isArray(parsed)) {
        throw new Error(`${fieldName} JSON must be an array of strings`)
      }
      return parsed.map(String)
    } catch (error) {
      throw new Error(`${fieldName} must be valid JSON: ${getErrorMessage(error)}`)
    }
  }
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function toNumberOrUndefined(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

export async function transformZoomInfoEnvelope(
  response: Response
): Promise<{ status: number; data: unknown }> {
  const data = (await response.json()) as
    | { success: true; output: { status: number; data: unknown } }
    | { success: false; error?: string; status?: number }
  if (!('success' in data) || data.success === false) {
    const errMessage = 'error' in data && data.error ? data.error : 'ZoomInfo request failed'
    throw new Error(errMessage)
  }
  return { status: data.output.status, data: data.output.data }
}

export const paginationOutputProperties: Record<string, OutputProperty> = {
  totalResults: {
    type: 'number',
    description: 'Total number of matching results across all pages',
    optional: true,
  },
  currentPage: {
    type: 'number',
    description: 'Current page number',
    optional: true,
  },
  totalPages: {
    type: 'number',
    description: 'Total number of pages available',
    optional: true,
  },
}

export function extractPagination(payload: unknown): {
  totalResults: number | null
  currentPage: number | null
  totalPages: number | null
} {
  if (payload && typeof payload === 'object') {
    const meta = (payload as Record<string, unknown>).meta as
      | { totalResults?: unknown; page?: { number?: unknown; total?: unknown } }
      | undefined
    if (meta) {
      const totalResults = typeof meta.totalResults === 'number' ? meta.totalResults : null
      const currentPage =
        meta.page && typeof meta.page.number === 'number' ? meta.page.number : null
      const totalPages = meta.page && typeof meta.page.total === 'number' ? meta.page.total : null
      return { totalResults, currentPage, totalPages }
    }
  }
  return { totalResults: null, currentPage: null, totalPages: null }
}

export function extractDataArray(payload: unknown): Array<Record<string, unknown>> {
  if (payload && typeof payload === 'object') {
    const data = (payload as Record<string, unknown>).data
    if (Array.isArray(data)) return data as Array<Record<string, unknown>>
  }
  return []
}
