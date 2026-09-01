import net from 'node:net'
import mysql from 'mysql2/promise'
import { validateDatabaseHost } from '@/lib/core/security/input-validation.server'

export interface MysqlConnectionConfig {
  host: string
  port: number
  database: string
  username: string
  password: string
  ssl: 'disabled' | 'required' | 'preferred'
}

const MYSQL_TYPED_PARAMETER_PROTOTYPE = Object.getPrototypeOf(mysql.TypedParameter.NULL())

function isMysqlExecuteValue(value: unknown): value is mysql.ExecuteValues {
  if (
    value === null ||
    ['string', 'number', 'bigint', 'boolean'].includes(typeof value) ||
    value instanceof Date ||
    value instanceof Blob ||
    value instanceof Uint8Array
  ) {
    return true
  }

  if (Array.isArray(value)) return value.every(isMysqlExecuteValue)
  if (typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype === MYSQL_TYPED_PARAMETER_PROTOTYPE) return true
  if (prototype !== Object.prototype) return false
  return Object.values(value).every(isMysqlExecuteValue)
}

function assertMysqlExecuteValues(
  values: unknown[] | undefined
): asserts values is mysql.ExecuteValues[] | undefined {
  if (values?.some((value) => !isMysqlExecuteValue(value))) {
    throw new TypeError('MySQL bind values must contain only supported scalar or structured values')
  }
}

export async function createMysqlConnection(
  config: MysqlConnectionConfig,
  signal?: AbortSignal
): Promise<mysql.Connection> {
  signal?.throwIfAborted()
  const hostValidation = await validateDatabaseHost(config.host, 'host')
  signal?.throwIfAborted()

  if (!hostValidation.isValid) {
    throw new Error(hostValidation.error)
  }

  const resolvedIp = hostValidation.resolvedIP ?? config.host
  let socket: net.Socket | undefined
  const destroySocket = () => socket?.destroy()
  signal?.addEventListener('abort', destroySocket, { once: true })

  const connectionConfig: mysql.ConnectionOptions = {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    stream: () => {
      socket = net.connect({ host: resolvedIp, port: config.port, timeout: 10000 })
      socket.setNoDelay(true)
      return socket
    },
  }

  if (config.ssl === 'required') {
    connectionConfig.ssl = { rejectUnauthorized: true }
  } else if (config.ssl === 'preferred') {
    connectionConfig.ssl = { rejectUnauthorized: false }
  }

  try {
    const connection = await mysql.createConnection(connectionConfig)
    signal?.throwIfAborted()
    return connection
  } catch (error) {
    signal?.throwIfAborted()
    throw error
  } finally {
    signal?.removeEventListener('abort', destroySocket)
  }
}

export async function executeMysqlCommand<TResult extends mysql.QueryResult>(
  connection: mysql.Connection,
  query: string,
  values?: unknown[],
  signal?: AbortSignal
): Promise<TResult> {
  signal?.throwIfAborted()
  const destroyConnection = () => connection.destroy()
  signal?.addEventListener('abort', destroyConnection, { once: true })

  try {
    assertMysqlExecuteValues(values)
    const [result] = await connection.execute<TResult>(query, values)
    signal?.throwIfAborted()
    return result
  } catch (error) {
    signal?.throwIfAborted()
    throw error
  } finally {
    signal?.removeEventListener('abort', destroyConnection)
  }
}
