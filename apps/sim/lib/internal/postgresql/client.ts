import postgres from 'postgres'
import { validateDatabaseHost } from '@/lib/core/security/input-validation.server'
import type { PostgresConnectionConfig } from '@/tools/postgresql/types'

export type PostgresClient = ReturnType<typeof postgres>

interface PendingPostgresQuery<TResult> extends PromiseLike<TResult> {
  cancel(): void
}

export async function createPostgresClient(
  config: PostgresConnectionConfig,
  signal?: AbortSignal
): Promise<PostgresClient> {
  signal?.throwIfAborted()
  const hostValidation = await validateDatabaseHost(config.host, 'host')
  signal?.throwIfAborted()

  if (!hostValidation.isValid) {
    throw new Error(hostValidation.error)
  }

  const resolvedHost = hostValidation.resolvedIP ?? config.host
  const sslConfig: boolean | 'prefer' | { rejectUnauthorized: boolean; servername?: string } =
    config.ssl === 'disabled'
      ? false
      : config.ssl === 'preferred'
        ? 'prefer'
        : { rejectUnauthorized: false, servername: config.host }

  return postgres({
    host: resolvedHost,
    port: config.port,
    database: config.database,
    username: config.username,
    password: config.password,
    ssl: sslConfig,
    connect_timeout: 10,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    max: 1,
  })
}

export async function executePostgresQuery<TResult>(
  query: PendingPostgresQuery<TResult>,
  signal?: AbortSignal
): Promise<TResult> {
  signal?.throwIfAborted()

  const cancelQuery = () => query.cancel()
  signal?.addEventListener('abort', cancelQuery, { once: true })

  try {
    if (signal?.aborted) {
      cancelQuery()
      signal.throwIfAborted()
    }
    const result = await query
    signal?.throwIfAborted()
    return result
  } finally {
    signal?.removeEventListener('abort', cancelQuery)
  }
}
