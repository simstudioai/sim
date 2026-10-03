import { createLogger } from '@sim/logger'
import {
  callSapOdata,
  fetchSapAccessToken,
  fetchSapCsrf,
  isSapWriteMethod,
  type SapOdataInvocation,
} from '@/lib/internal/sap-s4hana/client'
import type { SapS4HanaOperationInput } from '@/lib/internal/sap-s4hana/schema'

const logger = createLogger('SapS4HanaOperations')

export interface SapS4HanaOperationResult {
  status: number
  data: unknown
}

export class SapS4HanaProviderError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

function isCsrfRequired(invocation: SapOdataInvocation): boolean {
  if (invocation.status !== 403) return false
  if (invocation.csrfHeader === 'required') return true
  if (typeof invocation.body !== 'object' || invocation.body === null) return false
  const error = (invocation.body as { error?: { message?: { value?: string } | string } }).error
  const messageField = error?.message
  const message = typeof messageField === 'string' ? messageField : (messageField?.value ?? '')
  return message.toLowerCase().includes('csrf')
}

function extractOdataError(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const error = (
      body as {
        error?: {
          message?: { value?: string } | string
          code?: string
          innererror?: {
            errordetails?: Array<{ code?: string; message?: string; severity?: string }>
          }
        }
      }
    ).error
    if (error) {
      const messageField = error.message
      const base =
        typeof messageField === 'string' ? messageField : (messageField?.value ?? error.code ?? '')
      const prefix = error.code ? `[${error.code}] ` : ''
      const details = error.innererror?.errordetails
        ?.filter((detail) =>
          Boolean(detail.message && (!detail.severity || detail.severity.toLowerCase() !== 'info'))
        )
        .map((detail) => `${detail.code ? `[${detail.code}] ` : ''}${detail.message}`)
        .filter((message): message is string => Boolean(message))
      if (details && details.length > 0) {
        const extras = details.filter((detail) => !detail.endsWith(base))
        return extras.length > 0 ? `${prefix}${base} (${extras.join('; ')})` : `${prefix}${base}`
      }
      if (base) return `${prefix}${base}`
    }
  }
  if (typeof body === 'string' && body.length > 0) return body
  return `SAP request failed with HTTP ${status}`
}

function unwrapOdata(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body
  const root = (body as { d?: unknown }).d
  if (root === undefined) return body
  if (root && typeof root === 'object' && 'results' in (root as Record<string, unknown>)) {
    const result = root as { results: unknown; __count?: string; __next?: string }
    if (result.__count !== undefined || result.__next !== undefined) {
      return {
        results: result.results,
        ...(result.__count !== undefined && { __count: result.__count }),
        ...(result.__next !== undefined && { __next: result.__next }),
      }
    }
    return result.results
  }
  return root
}

export async function executeSapS4HanaOperation(
  input: SapS4HanaOperationInput,
  requestId: string,
  signal?: AbortSignal
): Promise<SapS4HanaOperationResult> {
  signal?.throwIfAborted()
  const isWrite = isSapWriteMethod(input.method)
  const accessToken =
    input.authType === 'oauth_client_credentials' ? await fetchSapAccessToken(input, signal) : null
  const csrf = isWrite ? await fetchSapCsrf(input, accessToken, signal) : null
  let invocation = await callSapOdata(input, accessToken, csrf, signal)

  if (isWrite && isCsrfRequired(invocation)) {
    logger.info(`[${requestId}] CSRF token rejected, refetching once`)
    const refreshed = await fetchSapCsrf(input, accessToken, signal)
    if (refreshed) {
      invocation = await callSapOdata(input, accessToken, refreshed, signal)
    }
  }

  signal?.throwIfAborted()
  if (invocation.status >= 200 && invocation.status < 300) {
    return {
      status: invocation.status,
      data: invocation.status === 204 ? null : unwrapOdata(invocation.body),
    }
  }

  const message = extractOdataError(invocation.body, invocation.status)
  logger.warn(
    `[${requestId}] SAP API error (${invocation.status}) ${input.service}${input.path}: ${message}`
  )
  throw new SapS4HanaProviderError(message, invocation.status)
}
