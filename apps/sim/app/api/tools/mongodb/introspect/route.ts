import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { mongodbIntrospectContract } from '@/lib/api/contracts/tools/databases/mongodb'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createMongoDBConnection, executeIntrospect } from '@/app/api/tools/mongodb/utils'

const logger = createLogger('MongoDBIntrospectAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)
  let client = null

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    logger.warn(`[${requestId}] Unauthorized MongoDB introspect attempt`)
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(mongodbIntrospectContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

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
})
