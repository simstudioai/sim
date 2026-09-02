import type { OracleBindScalar, OracleConnectionInput } from '@/lib/internal/oracledb/schema'

export const ORACLE_WORKER_PROTOCOL_VERSION = 1
export const ORACLE_MAX_WORKER_REQUEST_BYTES = 8 * 1024 * 1024
export const ORACLE_MAX_WORKER_RESPONSE_BYTES = 10 * 1024 * 1024 + 64 * 1024
export const ORACLE_MAX_WORKER_STATEMENTS = 8

export interface OracleWorkerConnection extends OracleConnectionInput {
  proxyHost: '127.0.0.1'
  proxyPort: number
}

export interface OracleWorkerStatement {
  sql: string
  binds?: Record<string, OracleBindScalar | string>
  autoCommit?: boolean
  maxRows: number
}

export interface OracleWorkerRequest {
  protocolVersion: typeof ORACLE_WORKER_PROTOCOL_VERSION
  type: 'execute'
  connection: OracleWorkerConnection
  statements: OracleWorkerStatement[]
  readOnlyTransaction: boolean
}

export interface OracleWorkerStatementResult {
  rows: Array<Record<string, unknown>>
  rowCount: number
  truncated?: boolean
  truncationReason?: string
}

export interface OracleWorkerSuccess {
  protocolVersion: typeof ORACLE_WORKER_PROTOCOL_VERSION
  ok: true
  results: OracleWorkerStatementResult[]
}

export interface OracleWorkerFailure {
  protocolVersion: typeof ORACLE_WORKER_PROTOCOL_VERSION
  ok: false
  error: {
    message: string
  }
}

export type OracleWorkerResponse = OracleWorkerSuccess | OracleWorkerFailure

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseStatementResult(value: unknown): OracleWorkerStatementResult {
  if (!isRecord(value) || !Array.isArray(value.rows)) {
    throw new Error('Oracle worker returned an invalid statement result')
  }
  if (!Number.isSafeInteger(value.rowCount) || (value.rowCount as number) < 0) {
    throw new Error('Oracle worker returned an invalid row count')
  }
  if (value.rows.some((row) => !isRecord(row))) {
    throw new Error('Oracle worker returned a non-object row')
  }
  if (value.truncated !== undefined && typeof value.truncated !== 'boolean') {
    throw new Error('Oracle worker returned an invalid truncation flag')
  }
  if (value.truncationReason !== undefined && typeof value.truncationReason !== 'string') {
    throw new Error('Oracle worker returned an invalid truncation reason')
  }

  return {
    rows: value.rows as Array<Record<string, unknown>>,
    rowCount: value.rowCount as number,
    ...(value.truncated === true && { truncated: true }),
    ...(typeof value.truncationReason === 'string' && {
      truncationReason: value.truncationReason,
    }),
  }
}

export function parseOracleWorkerResponse(value: unknown): OracleWorkerResponse {
  if (!isRecord(value) || value.protocolVersion !== ORACLE_WORKER_PROTOCOL_VERSION) {
    throw new Error('Oracle worker returned an unsupported protocol response')
  }

  if (value.ok === false) {
    if (!isRecord(value.error) || typeof value.error.message !== 'string') {
      throw new Error('Oracle worker returned an invalid error response')
    }
    return {
      protocolVersion: ORACLE_WORKER_PROTOCOL_VERSION,
      ok: false,
      error: { message: value.error.message },
    }
  }

  if (value.ok !== true || !Array.isArray(value.results)) {
    throw new Error('Oracle worker returned an invalid success response')
  }
  if (value.results.length > ORACLE_MAX_WORKER_STATEMENTS) {
    throw new Error('Oracle worker returned too many statement results')
  }

  return {
    protocolVersion: ORACLE_WORKER_PROTOCOL_VERSION,
    ok: true,
    results: value.results.map(parseStatementResult),
  }
}

export function serializeOracleWorkerRequest(request: OracleWorkerRequest): string {
  if (request.statements.length === 0 || request.statements.length > ORACLE_MAX_WORKER_STATEMENTS) {
    throw new Error(`Oracle worker accepts 1-${ORACLE_MAX_WORKER_STATEMENTS} statements per call`)
  }

  const serialized = JSON.stringify(request)
  if (Buffer.byteLength(serialized, 'utf8') > ORACLE_MAX_WORKER_REQUEST_BYTES) {
    throw new Error('Oracle worker request exceeds the 8 MiB transport ceiling')
  }
  return serialized
}
