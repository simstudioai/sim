import { randomUUID } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { buildInsertQuery, createMySQLConnection, executeQuery } from '@/app/api/tools/mysql/utils'

const logger = createLogger('MySQLInsertAPI')

const InsertSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive('Port must be a positive integer'),
  database: z.string().min(1, 'Database name is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  ssl: z.enum(['disabled', 'required', 'preferred']).default('preferred'),
  table: z.string().min(1, 'Table name is required'),
  data: z.union([
    z
      .record(z.unknown())
      .refine((obj) => Object.keys(obj).length > 0, 'Data object cannot be empty'),
    z
      .string()
      .min(1)
      .transform((str) => {
        try {
          const parsed = JSON.parse(str)
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error('Data must be a JSON object')
          }
          return parsed
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : 'Unknown error'
          throw new Error(
            `Invalid JSON format in data field: ${errorMsg}. Received: ${str.substring(0, 100)}...`
          )
        }
      }),
  ]),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  try {
    const body = await request.json()
    const params = InsertSchema.parse(body)

    logger.info(
      `[${requestId}] Inserting data into ${params.table} on ${params.host}:${params.port}/${params.database}`
    )

    const connection = await createMySQLConnection({
      host: params.host,
      port: params.port,
      database: params.database,
      username: params.username,
      password: params.password,
      ssl: params.ssl,
    })

    try {
      const { query, values } = buildInsertQuery(params.table, params.data)
      const result = await executeQuery(connection, query, values)

      logger.info(`[${requestId}] Insert executed successfully, ${result.rowCount} row(s) inserted`)

      return NextResponse.json({
        message: `Data inserted successfully. ${result.rowCount} row(s) affected.`,
        rows: result.rows,
        rowCount: result.rowCount,
      })
    } finally {
      await connection.end()
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
    logger.error(`[${requestId}] MySQL insert failed:`, error)

    return NextResponse.json({ error: `MySQL insert failed: ${errorMessage}` }, { status: 500 })
  }
}
