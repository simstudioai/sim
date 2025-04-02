import { createPool, PoolOptions, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    console.log('[MySQL API] Received request:', {
      ...body,
      password: body.password ? '[REDACTED]' : undefined,
      connection: body.connection ? { password: '[REDACTED]' } : undefined
    })

    // Extract connection parameters from either root level or connection object
    const connection = body.connection || {
      host: body.host,
      port: body.port,
      user: body.user || body.username,
      password: body.password,
      database: body.database,
      ssl: body.ssl === 'true'
    }

    // Check for required connection parameters
    const hasRequiredParams = {
      hasConnection: !!connection,
      hasHost: !!connection?.host,
      hasUsername: !!(connection?.user || connection?.username),
      hasPassword: !!connection?.password,
      hasDatabase: !!connection?.database
    }

    console.log('[MySQL API] Connection parameters check:', hasRequiredParams)

    if (!hasRequiredParams.hasConnection || !hasRequiredParams.hasHost || 
        !hasRequiredParams.hasUsername || !hasRequiredParams.hasPassword || 
        !hasRequiredParams.hasDatabase) {
      console.log('[MySQL API] Missing required connection parameters:', hasRequiredParams)
      throw new Error('Missing required connection parameters')
    }

    // Create MySQL connection pool
    console.log('[MySQL API] Creating connection pool with config:', {
      ...connection,
      password: '[REDACTED]'
    })
    
    const poolConfig: PoolOptions = {
      host: connection.host,
      port: parseInt(connection.port || '3306'),
      user: connection.user || connection.username,
      password: connection.password,
      database: connection.database,
      ssl: connection.ssl === 'true' ? { rejectUnauthorized: false } : undefined
    }
    
    const pool = createPool(poolConfig)

    // Execute query based on operation
    const { operation, query, params, options } = body
    console.log('[MySQL API] Executing query:', { operation, query, params, options })

    let result
    switch (operation?.toLowerCase()) {
      case 'select':
        result = await pool.query<RowDataPacket[]>(query, params)
        return NextResponse.json({ rows: result[0], fields: result[1] })
      
      case 'insert':
      case 'update':
      case 'delete':
        result = await pool.query<ResultSetHeader>(query, params)
        return NextResponse.json({ affectedRows: result[0].affectedRows })
      
      case 'execute':
        result = await pool.query(query, params)
        return NextResponse.json({ result })
      
      default:
        throw new Error(`Unsupported operation: ${operation}`)
    }
  } catch (error: any) {
    console.error('[MySQL API] Error:', error)
    
    // Handle specific MySQL errors
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      return NextResponse.json(
        { error: 'Access denied. Please check your username and password.' },
        { status: 401 }
      )
    }
    
    if (error.code === 'ECONNREFUSED') {
      return NextResponse.json(
        { error: 'Could not connect to MySQL server. Please check if the server is running and accessible.' },
        { status: 503 }
      )
    }
    
    if (error.code === 'ER_BAD_DB_ERROR') {
      return NextResponse.json(
        { error: 'Database does not exist.' },
        { status: 404 }
      )
    }
    
    if (error.code === 'ER_NO_SUCH_TABLE') {
      return NextResponse.json(
        { error: 'Table does not exist.' },
        { status: 404 }
      )
    }
    
    return NextResponse.json(
      { error: error.message || 'An error occurred while executing the query.' },
      { status: 500 }
    )
  }
} 