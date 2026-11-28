import { isIP } from 'node:net'
import { unwrapIpv6Brackets } from '@sim/security/ssrf'
import { MongoClient } from 'mongodb'
import {
  createPinnedLookup,
  validateDatabaseHost,
} from '@/lib/core/security/input-validation.server'

export interface MongodbConnectionConfig {
  host: string
  port: number
  database: string
  username?: string
  password?: string
  authSource?: string
  ssl?: 'disabled' | 'required' | 'preferred'
}

/**
 * MongoDB's database-name rules: 1–63 characters, none of `/\. "$*<>:|?` or NUL.
 * The driver itself only refuses a few of these, so check the full set up front.
 */
const INVALID_DATABASE_NAME_CHARACTERS = /[/\\. "$*<>:|?\0]/

function assertValidDatabaseName(database: string): void {
  if (
    database.length === 0 ||
    database.length > 63 ||
    INVALID_DATABASE_NAME_CHARACTERS.test(database)
  ) {
    throw new Error(
      'database must be 1-63 characters and cannot contain /, \\, ., spaces, ", $, *, <, >, :, |, or ?'
    )
  }
}

/**
 * Connects to exactly the validated host. Only the host and port enter the
 * connection string, both checked first; every other setting goes through the
 * options object so no field can add hosts or connection-string options, and
 * `directConnection` keeps the driver from following hosts a server advertises.
 */
export async function createMongodbClient(
  config: MongodbConnectionConfig,
  signal?: AbortSignal
): Promise<MongoClient> {
  signal?.throwIfAborted()
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('port must be an integer between 1 and 65535')
  }
  assertValidDatabaseName(config.database)

  const hostValidation = await validateDatabaseHost(config.host, 'host')
  signal?.throwIfAborted()

  if (!hostValidation.isValid) {
    throw new Error(hostValidation.error)
  }

  const host = unwrapIpv6Brackets(config.host)
  const uriHost = isIP(host) === 6 ? `[${host}]` : host
  const credentials =
    config.username && config.password
      ? {
          auth: { username: config.username, password: config.password },
          authSource: config.authSource || config.database,
        }
      : {}

  const client = new MongoClient(`mongodb://${uriHost}:${config.port}/`, {
    ...credentials,
    directConnection: true,
    ...(config.ssl === 'required' ? { tls: true } : {}),
    connectTimeoutMS: 10000,
    socketTimeoutMS: 10000,
    maxPoolSize: 1,
    lookup: createPinnedLookup(hostValidation.resolvedIP ?? host),
  })
  let rejectAbort: ((reason: unknown) => void) | undefined
  const abortPromise = signal
    ? new Promise<never>((_resolve, reject) => {
        rejectAbort = reject
      })
    : undefined
  const closeOnAbort = () => {
    void client.close().catch(() => undefined)
    rejectAbort?.(signal?.reason)
  }
  signal?.addEventListener('abort', closeOnAbort, { once: true })

  try {
    const connectPromise = client.connect()
    await (abortPromise ? Promise.race([connectPromise, abortPromise]) : connectPromise)
    signal?.throwIfAborted()
    return client
  } catch (error) {
    await client.close().catch(() => undefined)
    signal?.throwIfAborted()
    throw error
  } finally {
    signal?.removeEventListener('abort', closeOnAbort)
  }
}
