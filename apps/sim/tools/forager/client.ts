import { createLogger } from '@sim/logger'
import { truncate } from '@sim/utils/string'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { MAX_INLINE_MATERIALIZATION_BYTES } from '@/lib/execution/payloads/limits'
import { currentUserSchema, type ForagerResponseSchema } from '@/tools/forager/schemas'
import type { ForagerAuthParams } from '@/tools/forager/types'

const FORAGER_API_BASE_URL = 'https://api-v2.forager.ai'
const logger = createLogger('ForagerClient')

function parseAccountId(value: number | string, fieldName = 'accountId'): number {
  const accountId = typeof value === 'number' ? value : Number(value.trim())
  if (!Number.isInteger(accountId) || accountId <= 0) {
    throw new Error(`Forager ${fieldName} must be a positive integer`)
  }
  return accountId
}

async function parseResponseBody(response: Response, allowEmptyArray: boolean): Promise<unknown> {
  const text = await readResponseTextWithLimit(response, {
    maxBytes: response.ok ? MAX_INLINE_MATERIALIZATION_BYTES : DEFAULT_MAX_ERROR_BODY_BYTES,
    label: response.ok ? 'Forager response' : 'Forager error response',
  })
  if (!response.ok) {
    const detail = text.trim() ? `: ${truncate(text.trim(), 500)}` : ''
    throw new Error(
      `Forager API request failed (${response.status} ${response.statusText})${detail}`
    )
  }
  if (!text.trim()) {
    if (allowEmptyArray) return []
    throw new Error('Forager API returned an empty response where JSON was required')
  }
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed
  } catch {
    throw new Error('Forager API returned malformed JSON')
  }
}

async function resolveAccountId(params: ForagerAuthParams, signal?: AbortSignal): Promise<number> {
  if (params.accountId !== undefined && params.accountId !== '') {
    return parseAccountId(params.accountId)
  }

  const response = await fetch(`${FORAGER_API_BASE_URL}/api/users/current/`, {
    method: 'GET',
    headers: { Accept: 'application/json', 'X-API-KEY': params.apiKey },
    signal,
  })
  const data = currentUserSchema.parse(await parseResponseBody(response, false))
  if (data.accounts.length !== 1) {
    logger.warn('Forager account selection requires an explicit accountId', {
      accountCount: data.accounts.length,
    })
    throw new Error(
      `Forager accountId is required when the API key has ${data.accounts.length} accounts`
    )
  }
  return data.accounts[0].id
}

export function parseForagerFilters(value: Record<string, unknown> | string | undefined): unknown {
  if (value === undefined || value === '') return {}
  if (typeof value !== 'string') return value
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object')
    }
    return parsed
  } catch {
    throw new Error('Forager filters must be a valid JSON object')
  }
}

export function parseForagerInteger(value: number | string, fieldName: string): number {
  return parseAccountId(value, fieldName)
}

export async function foragerPost<T>(
  params: ForagerAuthParams,
  path: string,
  body: Record<string, unknown>,
  responseSchema: ForagerResponseSchema<T>,
  options: { allowEmptyArray?: boolean; signal?: AbortSignal } = {}
): Promise<T> {
  const accountId = await resolveAccountId(params, options.signal)
  const response = await fetch(`${FORAGER_API_BASE_URL}/api/${accountId}/${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-API-KEY': params.apiKey,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  })
  return responseSchema.parse(await parseResponseBody(response, options.allowEmptyArray ?? false))
}
