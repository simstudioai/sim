import { randomUUID } from 'crypto'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { createMongoDBConnection, executeIntrospect } from '../utils'

const logger = createLogger('MongoDBIntrospectAPI')

const IntrospectSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive('Port must be a positive integer'),
  database: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  authSource: z.string().optional(),
  ssl: z.enum(['disabled', 'required', 'preferred']).default('preferred'),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)
  let client = null

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    logger.warn(`[${requestId}] Unauthorized MongoDB introspect attempt`)
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = IntrospectSchema.parse(body)

    logger.info(
      `[${requestId}] Introspecting MongoDB at ${params.host}:${params.port}${params.database ? `/${params.database}` : ''}`
    )

    client = await createMongoDBConnection({
      host: params.host,
      port: params.port,
      database: params.database || 'admin',
      username: params.username,
      password: params.password,
      authSource: params.authSource,
      ssl: params.ssl,
    })

    const result = await executeIntrospect(client, params.database)

    logger.info(
      `[${requestId}] Introspection completed: ${result.databases.length} databases, ${result.collections.length} collections`
    )

    return NextResponse.json({
      message: result.message,
      databases: result.databases,
      collections: result.collections,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    logger.error(`[${requestId}] MongoDB introspect failed:`, error)

    return NextResponse.json(
      { error: `MongoDB introspect failed: ${errorMessage}` },
      { status: 500 }
    )
  } finally {
    if (client) {
      await client.close()
    }
  }
}
