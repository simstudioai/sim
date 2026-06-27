import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'

const logger = createLogger('LagoClient')

export class LagoApiError extends Error {
  readonly status: number
  readonly body: string

  constructor(message: string, status: number, body: string) {
    super(message)
    this.name = 'LagoApiError'
    this.status = status
    this.body = body
  }
}

export function hasValidLagoCredentials(): boolean {
  return Boolean(env.LAGO_API_URL?.trim() && env.LAGO_API_KEY?.trim())
}

function getLagoBaseUrl(): string {
  const base = env.LAGO_API_URL?.trim()
  if (!base) {
    throw new Error('LAGO_API_URL is not configured')
  }
  return base.replace(/\/$/, '')
}

function getLagoApiKey(): string {
  const key = env.LAGO_API_KEY?.trim()
  if (!key) {
    throw new Error('LAGO_API_KEY is not configured')
  }
  return key
}

/**
 * Low-level Lago REST client. All paths are relative to `/api/v1`.
 */
export async function lagoRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${getLagoBaseUrl()}/api/v1${path}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getLagoApiKey()}`,
    Accept: 'application/json',
  }

  const init: RequestInit = { method, headers }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    logger.error('Lago API network error', { method, path, error: getErrorMessage(error) })
    throw error
  }

  const text = await response.text()
  if (!response.ok) {
    logger.error('Lago API error response', {
      method,
      path,
      status: response.status,
      body: text.slice(0, 500),
    })
    throw new LagoApiError(`Lago API ${method} ${path} failed`, response.status, text)
  }

  if (!text) {
    return {} as T
  }

  try {
    return JSON.parse(text) as T
  } catch {
    throw new LagoApiError(`Lago API returned invalid JSON for ${path}`, response.status, text)
  }
}
