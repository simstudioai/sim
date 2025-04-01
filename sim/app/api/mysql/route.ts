import { createPool } from 'mysql2/promise'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const params = await request.json()
    const { connection, operation, query, params: queryParams, options } = params

    // Create MySQL connection pool
    const pool = createPool({
      host: connection.host,
      port: connection.port,
      user: connection.user,
      password: connection.password,
      database: connection.database,
      ssl: connection.ssl ? { rejectUnauthorized: false } : undefined,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    })

    let result
    try {
      // Execute query based on operation type
      switch (operation.toLowerCase()) {
        case 'select':
        case 'insert':
        case 'update':
        case 'delete':
        case 'execute':
          const [rows, fields] = await pool.execute(query, queryParams || [])
          result = {
            rows,
            fields: fields ? fields.map(field => ({ name: field.name })) : []
          }
          break

        default:
          throw new Error(`Unsupported operation: ${operation}`)
      }

      await pool.end()

      return NextResponse.json({
        data: result.rows,
        affectedRows: Array.isArray(result.rows) ? result.rows.length : (result.rows as any)?.affectedRows || 0,
        fields: result.fields,
        metadata: {
          operation,
          query,
          timestamp: new Date().toISOString(),
          connection: {
            host: connection.host,
            port: connection.port,
            database: connection.database
          }
        }
      })

    } catch (error) {
      // Handle specific MySQL errors
      if (error instanceof Error) {
        if (error.message.includes('ER_ACCESS_DENIED_ERROR')) {
          throw new Error('Access denied. Check your username and password.')
        }
        if (error.message.includes('ECONNREFUSED')) {
          throw new Error('Could not connect to MySQL server')
        }
        if (error.message.includes('ER_BAD_DB_ERROR')) {
          throw new Error(`Database "${connection.database}" does not exist`)
        }
        if (error.message.includes('ER_NO_SUCH_TABLE')) {
          throw new Error('Table does not exist')
        }
      }
      throw error
    }

  } catch (error) {
    console.error('MySQL API Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error occurred' },
      { status: 500 }
    )
  }
} 