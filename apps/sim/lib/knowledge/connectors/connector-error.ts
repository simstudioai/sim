import { findCause, getPostgresErrorCode } from '@sim/utils/errors'
import { DrizzleQueryError } from 'drizzle-orm/errors'
import { EmbeddingAPIError } from '@/lib/embeddings/api-error'
import {
  ConnectorDirectoryError,
  ConnectorSourceError,
  type ConnectorSourceFailureCategory,
  type ConnectorSourceReasonState,
} from '@/connectors/source-error'

export interface ConnectorFailureDiagnostic {
  category: 'directory' | 'database' | 'embedding' | ConnectorSourceFailureCategory | 'transport'
  message: string
  status?: number
  code?: string
  operation?: string
  reasons?: readonly string[]
  reasonState?: ConnectorSourceReasonState
  phase?: 'directory'
}

const TRANSPORT_CODES = new Set([
  'CONNECT_TIMEOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_DESTROYED',
  'CONNECTION_ENDED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
])

/**
 * Projects machine-readable causes into bounded diagnostics. Provider bodies,
 * SQL, bound parameters, URLs and arbitrary exception messages never enter the
 * result. Unknown failures retain the caller's domain-specific fallback.
 */
function classifyFailure(error: unknown): ConnectorFailureDiagnostic | null {
  const code = getPostgresErrorCode(error)
  const databaseError = findCause(
    error,
    (value): value is Error =>
      value instanceof DrizzleQueryError ||
      (value instanceof Error &&
        'query' in value &&
        typeof value.query === 'string' &&
        'params' in value &&
        Array.isArray(value.params))
  )
  if (code && TRANSPORT_CODES.has(code)) {
    return {
      category: databaseError ? 'database' : 'transport',
      code,
      message: `${databaseError ? 'Database' : 'Source'} connection failed (${code}). The connector will retry at its next scheduled sync.`,
    }
  }
  if (code && /^(?:[0-9][0-9A-Z]|F0|HV|P0|XX)[0-9A-Z]{3}$/.test(code)) {
    return {
      category: 'database',
      code,
      message: `Database request failed (SQLSTATE ${code}).`,
    }
  }
  if (databaseError) {
    return { category: 'database', message: 'Database request failed without a driver error code.' }
  }
  const httpError = findCause(
    error,
    (value): value is Error & { status: number } =>
      value instanceof Error &&
      'status' in value &&
      typeof value.status === 'number' &&
      Number.isInteger(value.status) &&
      value.status >= 400 &&
      value.status <= 599
  )
  if (!httpError) return null
  const { status } = httpError
  if (httpError instanceof EmbeddingAPIError) {
    return {
      category: 'embedding',
      status,
      message: `Embedding service request failed (HTTP ${status}).`,
    }
  }
  const category = httpError instanceof ConnectorSourceError ? httpError.category : undefined
  if (category === 'authorization' || (!category && (status === 401 || status === 403))) {
    return {
      category: 'authorization',
      status,
      message: `Source content access was denied (HTTP ${status}). Check the connector account's file access and download permissions.`,
    }
  }
  if (category === 'source_unavailable' || (!category && (status === 404 || status === 410))) {
    return {
      category: 'source_unavailable',
      status,
      message: `Source content is unavailable (HTTP ${status}). It may have moved, been removed, or lost sharing access.`,
    }
  }
  if (category === 'rate_limit' || (!category && status === 429)) {
    return {
      category: 'rate_limit',
      status,
      message: `Source request quota or rate limit was exceeded (HTTP ${status}). The connector will retry after backoff.`,
    }
  }
  if (category === 'provider_unavailable' || (!category && (status >= 500 || status === 408))) {
    return {
      category: 'provider_unavailable',
      status,
      message: `Source service is temporarily unavailable (HTTP ${status}). The connector will retry at its next scheduled sync.`,
    }
  }
  return {
    category: 'request_rejected',
    status,
    message: `Source content request was rejected (HTTP ${status}). Check the source's download restrictions and supported content.`,
  }
}

/** Preserves safe provider context and directory scope across wrapped failures. */
export function getConnectorFailureDiagnostic(error: unknown): ConnectorFailureDiagnostic | null {
  const diagnostic = classifyFailure(error)
  const directoryError = findCause(
    error,
    (value): value is ConnectorDirectoryError => value instanceof ConnectorDirectoryError
  )
  const sourceError = findCause(
    error,
    (value): value is ConnectorSourceError => value instanceof ConnectorSourceError
  )
  const context = sourceError?.diagnostic
  if (directoryError) {
    const status = diagnostic?.status ? ` (HTTP ${diagnostic.status})` : ''
    const code = diagnostic?.code ? ` Error code: ${diagnostic.code}.` : ''
    const reason = context?.reasons.length ? ` Google reason: ${context.reasons.join(', ')}.` : ''
    return {
      ...diagnostic,
      ...context,
      category: diagnostic?.category ?? 'directory',
      phase: 'directory',
      message: `Directory permission sync failed${status}.${context ? ` Operation: ${context.operation}.` : ''}${reason}${code} Group membership could not be fully verified.`,
    }
  }
  if (!diagnostic || !context) return diagnostic
  const reason = context.reasons.length ? ` Google reason: ${context.reasons.join(', ')}.` : ''
  return {
    ...diagnostic,
    ...context,
    message: `Google request failed (HTTP ${diagnostic.status}). Operation: ${context.operation}.${reason}`,
  }
}
