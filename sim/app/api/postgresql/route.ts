import { Pool, FieldDef } from 'pg'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const params = await request.json()
    const { connection, operation, query, params: queryParams, options } = params

    // Create connection pool
    const { host, port, username, password, database, ssl } = connection
    const pool = new Pool({
      host,
      port,
      user: username,
      password,
      database,
      ssl: ssl ? { rejectUnauthorized: false } : undefined
    })

    // Execute query
    const result = await pool.query(query, queryParams || [])

    // Close pool
    await pool.end()

    return NextResponse.json({
      rows: result.rows,
      rowCount: result.rowCount,
      fields: result.fields?.map((field: FieldDef) => ({
        name: field.name,
        type: field.dataTypeID
      })) || []
    })

  } catch (error) {
    console.error('PostgreSQL API Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error occurred' },
      { status: 500 }
    )
  }
} 