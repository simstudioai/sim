import { randomUUID } from 'crypto'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { createPostgresConnection, executeIntrospect } from '@/app/api/tools/postgresql/utils'

const logger = createLogger('PostgreSQLIntrospectAPI')

const IntrospectSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive('Port must be a positive integer'),
  database: z.string().min(1, 'Database name is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  ssl: z.enum(['disabled', 'required', 'preferred']).default('preferred'),
  schema: z.string().default('public'),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized PostgreSQL introspect attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const params = IntrospectSchema.parse(body)

    logger.info(
      `[${requestId}] Introspecting PostgreSQL schema on ${params.host}:${params.port}/${params.database}`
    )

    const sql = createPostgresConnection({
      host: params.host,
      port: params.port,
      database: params.database,
      username: params.username,
      password: params.password,
      ssl: params.ssl,
    })

    try {
      const result = await executeIntrospect(sql, params.schema)

      logger.info(
        `[${requestId}] Introspection completed successfully, found ${result.tables.length} tables`
      )

      return NextResponse.json({
        message: `Schema introspection completed. Found ${result.tables.length} table(s) in schema '${params.schema}'.`,
        tables: result.tables,
        schemas: result.schemas,
      })
    } finally {
      await sql.end()
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    logger.error(`[${requestId}] PostgreSQL introspection failed:`, error)

    return NextResponse.json(
      { error: `PostgreSQL introspection failed: ${errorMessage}` },
      { status: 500 }
    )
  }
}
