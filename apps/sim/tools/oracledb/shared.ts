import { toArray, toRecord } from '@sim/utils/object'
import type { OracleConnectionConfig, OracleExecutionResponse } from '@/tools/oracledb/types'

export const ORACLE_CONNECTION_PARAMS = {
  host: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Oracle Database hostname or IP address',
  },
  port: {
    type: 'number',
    required: false,
    visibility: 'user-only',
    description: 'Oracle Net listener port (default: 1521)',
  },
  protocol: {
    type: 'string',
    required: false,
    visibility: 'user-only',
    description:
      'Oracle Net transport: tcp sends traffic without TLS, while tcps requires TLS with hostname and certificate verification (default: tcp)',
  },
  connectionType: {
    type: 'string',
    required: false,
    visibility: 'user-only',
    description: 'Connection identifier type: serviceName or sid (default: serviceName)',
  },
  serviceName: {
    type: 'string',
    required: false,
    visibility: 'user-only',
    description: 'Oracle service name, required when connectionType is serviceName',
  },
  sid: {
    type: 'string',
    required: false,
    visibility: 'user-only',
    description: 'Oracle system identifier, required when connectionType is sid',
  },
  username: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Oracle Database username',
  },
  password: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Oracle Database password',
  },
  connectionTimeout: {
    type: 'number',
    required: false,
    visibility: 'user-only',
    description: 'Connection timeout in milliseconds (default: 15000)',
  },
  walletContent: {
    type: 'string',
    required: false,
    visibility: 'user-only',
    description:
      'PEM content copied from ewallet.pem for TCPS mutual TLS authentication (maximum: 1 MiB)',
  },
  walletPassword: {
    type: 'string',
    required: false,
    visibility: 'user-only',
    description: 'Password for an encrypted PEM wallet, when required',
  },
} as const

export { ORACLE_EXECUTION_OUTPUTS } from '@/tools/oracledb/types'

/** Projects shared tool parameters into the worker's connection contract. */
export function buildOracleConnectionInput(params: OracleConnectionConfig) {
  return {
    host: params.host,
    port: params.port ?? 1521,
    protocol: params.protocol ?? 'tcp',
    connectionType: params.connectionType ?? 'serviceName',
    ...(params.serviceName !== undefined ? { serviceName: params.serviceName } : {}),
    ...(params.sid !== undefined ? { sid: params.sid } : {}),
    username: params.username,
    password: params.password,
    connectionTimeout: params.connectionTimeout ?? 15000,
    ...(params.walletContent !== undefined ? { walletContent: params.walletContent } : {}),
    ...(params.walletPassword !== undefined ? { walletPassword: params.walletPassword } : {}),
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
