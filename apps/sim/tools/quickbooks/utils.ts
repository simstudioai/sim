import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import {
  buildQuickBooksCompanyUrl,
  buildQuickBooksHeaders,
  QUICKBOOKS_MAX_RESPONSE_BYTES,
} from '@/lib/quickbooks/client'
import { sanitizeQuickBooksFaultData } from '@/lib/quickbooks/fault'
import { ErrorExtractorId, extractErrorMessage } from '@/tools/error-extractors'
import type { QuickBooksListResponse, QuickBooksPaginationParams } from '@/tools/quickbooks/types'

export type QuickBooksQueryEntity = 'Bill' | 'PurchaseOrder' | 'Vendor'

interface QuickBooksQueryResponse<T> {
  QueryResponse?: {
    Bill?: T[]
    PurchaseOrder?: T[]
    Vendor?: T[]
    startPosition?: number
    maxResults?: number
  }
  time?: string
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

export function buildQuickBooksQueryUrl(
  realmId: string,
  entity: QuickBooksQueryEntity,
  startPosition: number,
  maxResults: number
): URL {
  const pagination = validateQuickBooksPagination(startPosition, maxResults)
  const url = buildQuickBooksCompanyUrl(realmId, 'query')
  url.searchParams.set(
    'query',
    `SELECT * FROM ${entity} STARTPOSITION ${pagination.startPosition} MAXRESULTS ${pagination.maxResults}`
  )
  return url
}

export async function parseQuickBooksJson<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`QuickBooks request failed with HTTP ${response.status}`)
  }
  const data = await readResponseJsonWithLimit<T>(response, {
    maxBytes: QUICKBOOKS_MAX_RESPONSE_BYTES,
    label,
  })
  const faultData = sanitizeQuickBooksFaultData(data)
  if (faultData) {
    const errorInfo = {
      status: response.status,
      statusText: response.statusText,
      data: faultData,
      headers: response.headers,
    }
    throw Object.assign(
      new Error(extractErrorMessage(errorInfo, ErrorExtractorId.QUICKBOOKS_FAULT)),
      errorInfo
    )
  }
  return data
}

export async function transformQuickBooksListResponse<T>(
  response: Response,
  params: QuickBooksPaginationParams,
  entity: QuickBooksQueryEntity
): Promise<QuickBooksListResponse<T>> {
  const data = await parseQuickBooksJson<QuickBooksQueryResponse<T>>(
    response,
    `QuickBooks ${entity} query response`
  )
  const queryResponse = data.QueryResponse
  if (!queryResponse || typeof queryResponse !== 'object' || Array.isArray(queryResponse)) {
    throw new Error(`QuickBooks ${entity} response is missing QueryResponse`)
  }

  const candidate = queryResponse[entity]
  if (candidate !== undefined && !Array.isArray(candidate)) {
    throw new Error(`QuickBooks ${entity} response contains a malformed entity list`)
  }

  const items = (candidate ?? []) as T[]
  const startPosition = Number.isInteger(queryResponse.startPosition)
    ? (queryResponse.startPosition as number)
    : params.startPosition
  const maxResults = Number.isInteger(queryResponse.maxResults)
    ? (queryResponse.maxResults as number)
    : items.length

  return {
    success: true,
    output: {
      items,
      startPosition,
      maxResults,
      nextStartPosition: startPosition + items.length,
      hasMore: items.length === params.maxResults,
      time: typeof data.time === 'string' ? data.time : null,
    },
  }
}

export function getQuickBooksToolHeaders(accessToken: string): Record<string, string> {
  return buildQuickBooksHeaders(accessToken)
}
