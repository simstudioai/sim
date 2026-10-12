import { toArray, toRecord } from '@sim/utils/object'
import type { OracleConnectionConfig, OracleExecutionResponse } from '@/tools/oracledb/types'

export const ORACLE_CONNECTION_PARAMS = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Saved Oracle Database connection',
  },
  accessToken: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Executor-authorized credential reference',
  },
  connectionTimeout: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Connection timeout in milliseconds (default: 15000)',
  },
} as const

export const oracleDatabaseOAuth = { enabled: true, required: true, provider: 'oracledb' } as const

/** Only the credential reference authorized by the executor crosses into the operation. */
export function buildOracleConnectionInput(params: OracleConnectionConfig) {
  return {
    credentialId: params.accessToken ?? '',
    connectionTimeout: params.connectionTimeout ?? 15000,
  }
}

/** Converts the bounded internal-operation response into the common database tool result. */
export async function transformOracleExecutionResponse(
  response: Response,
  defaults: { failure: string; success: string }
): Promise<OracleExecutionResponse> {
  const payload: unknown = await response.json()
  const data = toRecord(payload)

  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : defaults.failure)
  }

  const rows = toArray(data.rows)
  const rowCount = typeof data.rowCount === 'number' ? data.rowCount : rows.length

  return {
    success: true,
    output: {
      message: typeof data.message === 'string' ? data.message : defaults.success,
      rows,
      rowCount,
      ...(data.truncated === true
        ? {
            truncated: true,
            ...(typeof data.truncationReason === 'string'
              ? { truncationReason: data.truncationReason }
              : {}),
          }
        : {}),
    },
  }
}
