import { createPool, PoolOptions, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { NextResponse } from 'next/server'
<<<<<<< HEAD
import { getMySQLConfig } from '@/config/database'
=======
>>>>>>> 7fd5c86 (feat(database) tools -)

export async function POST(request: Request) {
  try {
    const body = await request.json()
    console.log('[MySQL API] Received request:', {
      ...body,
      password: body.password ? '[REDACTED]' : undefined,
<<<<<<< HEAD
      connection: body.connection ? { 
        ...body.connection,
        password: body.connection.password ? '[REDACTED]' : undefined 
      } : undefined
    })

    // Get connection parameters from either:
    // 1. Request body
    // 2. Environment variables
    let connection = body.connection || {
=======
      connection: body.connection ? { password: '[REDACTED]' } : undefined
    })

    // Extract connection parameters from either root level or connection object
    const connection = body.connection || {
>>>>>>> 7fd5c86 (feat(database) tools -)
      host: body.host,
      port: body.port,
      user: body.user || body.username,
      password: body.password,
      database: body.database,
      ssl: body.ssl === 'true'
    }

<<<<<<< HEAD
    // If no connection details provided in the request, try to get from environment
    if (!connection.host || !connection.user || !connection.password || !connection.database) {
      const envConfig = getMySQLConfig()
      if (envConfig) {
        connection = {
          ...connection,
          host: connection.host || envConfig.host,
          port: connection.port || envConfig.port,
          user: connection.user || envConfig.user,
          password: connection.password || envConfig.password,
          database: connection.database || envConfig.database,
          ssl: connection.ssl !== undefined ? connection.ssl : envConfig.ssl
        }
      }
    }

=======
>>>>>>> 7fd5c86 (feat(database) tools -)
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
    
<<<<<<< HEAD
    console.log('[MySQL API] Attempting to create connection pool with config:', {
      ...poolConfig,
      password: '[REDACTED]'
    })
    
    const pool = createPool(poolConfig)
    
    // Test the connection with a simple query
    console.log('[MySQL API] Testing connection with SELECT 1')
    try {
      await pool.query('SELECT 1')
      console.log('[MySQL API] Connection test successful')
    } catch (testError: any) {
      console.error('[MySQL API] Connection test failed:', testError)
      throw testError
    }
=======
    const pool = createPool(poolConfig)
>>>>>>> 7fd5c86 (feat(database) tools -)

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
<<<<<<< HEAD
    console.error('[MySQL API] Error details:', {
      name: error.name,
      message: error.message,
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage
    })
=======
>>>>>>> 7fd5c86 (feat(database) tools -)
    
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