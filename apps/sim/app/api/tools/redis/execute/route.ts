import { createLogger } from '@sim/logger'
import Redis from 'ioredis'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'

const logger = createLogger('RedisAPI')

const RequestSchema = z.object({
  url: z.string().min(1, 'Redis connection URL is required'),
  command: z.string().min(1, 'Redis command is required'),
  args: z.array(z.union([z.string(), z.number()])).default([]),
})

export async function POST(request: NextRequest) {
  let client: Redis | null = null

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { url, command, args } = RequestSchema.parse(body)

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
}
