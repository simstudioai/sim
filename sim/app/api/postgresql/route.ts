import { Pool, FieldDef } from 'pg'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    console.log('[PostgreSQL API] Received request')
    
    const params = await request.json()
    console.log('[PostgreSQL API] Parsed request params:', {
      ...params,
      connection: {
        ...params.connection,
        password: '[REDACTED]'
      }
    })
    
    const { connection, operation, query, params: queryParams, options } = params

    // Create connection pool
    const { host, port, username, password, database, ssl } = connection
    console.log('[PostgreSQL API] Creating connection pool:', { host, port, database, ssl })
    
    const pool = new Pool({
      host,
      port,
      user: username,
      password,
      database,
      ssl: ssl ? { rejectUnauthorized: false } : undefined
    })

    // Test connection
    try {
      console.log('[PostgreSQL API] Testing connection...')
      await pool.query('SELECT 1')
      console.log('[PostgreSQL API] Connection test successful')
    } catch (error) {
      console.error('[PostgreSQL API] Connection test failed:', error)
      throw error
    }

    // Execute query
    console.log('[PostgreSQL API] Executing query:', query)
    const result = await pool.query(query, queryParams || [])
    console.log('[PostgreSQL API] Query result:', {
      rowCount: result.rowCount,
      fieldCount: result.fields?.length,
      rows: result.rows
    })

    // Close pool
    await pool.end()
    console.log('[PostgreSQL API] Connection pool closed')

    return NextResponse.json({
      rows: result.rows,
      rowCount: result.rowCount,
      fields: result.fields?.map((field: FieldDef) => ({
        name: field.name,
        type: field.dataTypeID
      })) || []
    })

  } catch (error) {
    console.error('[PostgreSQL API] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error occurred' },
      { status: 500 }
    )
  }
} 