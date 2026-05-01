import { createLogger } from '@sim/logger'
import Redis from 'ioredis'
import { type NextRequest, NextResponse } from 'next/server'
import { redisExecuteContract } from '@/lib/api/contracts/tools/databases/redis'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateDatabaseHost } from '@/lib/core/security/input-validation.server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('RedisAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  let client: Redis | null = null

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(redisExecuteContract, request, {
      errorFormat: 'firstError',
      logger,
    })
    if (!parsed.success) return parsed.response
    const { url, command, args } = parsed.data.body

    const parsedUrl = new URL(url)
    const hostname =
      parsedUrl.hostname.startsWith('[') && parsedUrl.hostname.endsWith(']')
        ? parsedUrl.hostname.slice(1, -1)
        : parsedUrl.hostname
    const hostValidation = await validateDatabaseHost(hostname, 'host')
    if (!hostValidation.isValid) {
      return NextResponse.json({ error: hostValidation.error }, { status: 400 })
    }

    client = new Redis(url, {
      connectTimeout: 10000,
      commandTimeout: 10000,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    })

    await client.connect()

    const cmd = command.toUpperCase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (client as any).call(cmd, ...args)

    await client.quit()
    client = null

    return NextResponse.json({ result })
  } catch (error) {
    logger.error('Redis command failed', { error })
    const errorMessage = error instanceof Error ? error.message : 'Redis command failed'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  } finally {
    if (client) {
      try {
        await client.quit()
      } catch {
        client.disconnect()
      }
    }
  }
})
