import { validateDatabaseHost } from '@/lib/core/security/input-validation.server'
import { createRedisClient, executeRedisClientCommand } from '@/lib/internal/redis/client'
import type { RedisExecuteInput } from '@/lib/internal/redis/schema'

export class RedisOperationInputError extends Error {
  constructor(readonly responseError: string | undefined) {
    super(responseError)
  }
}

function getDatabaseIndex(parsedUrl: URL): number {
  if (!parsedUrl.pathname || parsedUrl.pathname.length <= 1) return 0

  const dbSegment = parsedUrl.pathname.slice(1)
  const parsedDb = Number.parseInt(dbSegment, 10)
  if (!Number.isFinite(parsedDb) || String(parsedDb) !== dbSegment) {
    throw new RedisOperationInputError(`Invalid Redis database index in URL path: '${dbSegment}'`)
  }
  return parsedDb
}

export async function executeRedisCommand(
  input: RedisExecuteInput,
  signal?: AbortSignal
): Promise<{ result: unknown }> {
  signal?.throwIfAborted()

  const parsedUrl = new URL(input.url)
  const hostname =
    parsedUrl.hostname.startsWith('[') && parsedUrl.hostname.endsWith(']')
      ? parsedUrl.hostname.slice(1, -1)
      : parsedUrl.hostname
  const hostValidation = await validateDatabaseHost(hostname, 'host')
  signal?.throwIfAborted()
  if (!hostValidation.isValid) {
    throw new RedisOperationInputError(hostValidation.error)
  }

  const resolvedIP = hostValidation.resolvedIP ?? hostname
  const client = createRedisClient({
    host: resolvedIP,
    port: parsedUrl.port ? Number(parsedUrl.port) : 6379,
    username: parsedUrl.username ? decodeURIComponent(parsedUrl.username) : undefined,
    password: parsedUrl.password ? decodeURIComponent(parsedUrl.password) : undefined,
    db: getDatabaseIndex(parsedUrl),
    family: resolvedIP.includes(':') ? 6 : 4,
    tlsServername: parsedUrl.protocol === 'rediss:' ? hostname : undefined,
  })

  const disconnectOnAbort = () => client.disconnect()
  signal?.addEventListener('abort', disconnectOnAbort, { once: true })
  let clientClosed = false

  try {
    await client.connect()
    signal?.throwIfAborted()
    const result = await executeRedisClientCommand(client, input.command.toUpperCase(), input.args)
    signal?.throwIfAborted()

    await client.quit()
    clientClosed = true
    return { result }
  } finally {
    signal?.removeEventListener('abort', disconnectOnAbort)
    if (!clientClosed) {
      try {
        await client.quit()
      } catch {
        client.disconnect()
      }
    }
    signal?.throwIfAborted()
  }
}
