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

export async function createMongodbClient(
  config: MongodbConnectionConfig,
  signal?: AbortSignal
): Promise<MongoClient> {
  signal?.throwIfAborted()
  const hostValidation = await validateDatabaseHost(config.host, 'host')
  signal?.throwIfAborted()

  if (!hostValidation.isValid) {
    throw new Error(hostValidation.error)
  }

  const credentials =
    config.username && config.password
      ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@`
      : ''
  const queryParams = new URLSearchParams()

  if (config.authSource) {
    queryParams.append('authSource', config.authSource)
  }
  if (config.ssl === 'required') {
    queryParams.append('ssl', 'true')
  }

  const queryString = queryParams.toString()
  const uri = `mongodb://${credentials}${config.host}:${config.port}/${config.database}${queryString ? `?${queryString}` : ''}`
  const client = new MongoClient(uri, {
    connectTimeoutMS: 10000,
    socketTimeoutMS: 10000,
    maxPoolSize: 1,
    lookup: createPinnedLookup(hostValidation.resolvedIP ?? config.host),
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
