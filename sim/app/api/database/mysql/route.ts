import { createPool, PoolOptions, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { getMySQLConfig } from '@/config/database'

const logger = createLogger('MySQLAPI')

// SQL injection prevention patterns
const DANGEROUS_SQL_PATTERNS = [
  /--/,                // SQL comments
  /;.*;/,             // Multiple statements
  /EXEC\s+xp_/i,      // Extended stored procedures
  /EXEC\s+sp_/i,      // System stored procedures
  /INTO\s+OUTFILE/i,  // File operations
  /LOAD_FILE/i,       // File operations
  /UNION\s+ALL/i,     // UNION injections
  /UNION\s+SELECT/i,  // UNION injections
  /\/\*/,             // Block comments
  /xp_cmdshell/i,     // Command execution
]

// Validate SQL query for potential injection attempts
function validateSQLQuery(query: string): void {
  // Check for dangerous patterns
  const hasDangerousPattern = DANGEROUS_SQL_PATTERNS.some(pattern => pattern.test(query))
  if (hasDangerousPattern) {
    throw new Error('Query contains potentially dangerous SQL patterns')
  }

  // Validate basic query structure
  const normalizedQuery = query.trim().toLowerCase()
  
  // Ensure proper SELECT structure
  if (normalizedQuery.startsWith('select') && !normalizedQuery.includes('from')) {
    throw new Error('Invalid SELECT query structure')
  }

  // Ensure proper INSERT structure
  if (normalizedQuery.startsWith('insert') && !normalizedQuery.includes('into')) {
    throw new Error('Invalid INSERT query structure')
  }

  // Ensure proper UPDATE structure
  if (normalizedQuery.startsWith('update') && !normalizedQuery.includes('set')) {
    throw new Error('Invalid UPDATE query structure')
  }

  // Ensure proper DELETE structure
  if (normalizedQuery.startsWith('delete') && !normalizedQuery.includes('from')) {
    throw new Error('Invalid DELETE query structure')
  }
}

export async function POST(request: Request) {
  let pool = null
  try {
    const body = await request.json()
    logger.info('Received request:', {
      ...body,
      password: body.password ? '[REDACTED]' : undefined,
      connection: body.connection ? { 
        ...body.connection,
        password: body.connection.password ? '[REDACTED]' : undefined 
      } : undefined
    })

    // Get connection parameters from either:
    // 1. Request body
    // 2. Environment variables
    let connection = body.connection || {
      host: body.host,
      port: body.port,
      user: body.user || body.username,
      password: body.password,
      database: body.database,
      ssl: body.ssl === 'true'
    }

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

    // Check for required connection parameters
    const hasRequiredParams = {
      hasConnection: !!connection,
      hasHost: !!connection?.host,
      hasUsername: !!(connection?.user || connection?.username),
      hasPassword: !!connection?.password,
      hasDatabase: !!connection?.database
    }

    logger.debug('Connection parameters check:', hasRequiredParams)

    if (!hasRequiredParams.hasConnection || !hasRequiredParams.hasHost || 
        !hasRequiredParams.hasUsername || !hasRequiredParams.hasPassword || 
        !hasRequiredParams.hasDatabase) {
      logger.warn('Missing required connection parameters:', hasRequiredParams)
      throw new Error('Missing required connection parameters')
    }

    // Create MySQL connection pool with secure SSL configuration
    logger.info('Creating connection pool with config:', {
      ...connection,
      password: '[REDACTED]'
    })
    
    const poolConfig: PoolOptions = {
      host: connection.host,
      port: parseInt(connection.port || '3306'),
      user: connection.user || connection.username,
      password: connection.password,
      database: connection.database,
      ssl: connection.ssl === 'true' ? {
        rejectUnauthorized: true, // Enable certificate validation
        minVersion: 'TLSv1.2',    // Enforce minimum TLS version
        ca: process.env.MYSQL_CA_CERT // Optional: Use custom CA certificate
      } : undefined,
      connectionLimit: 10,         // Limit maximum connections
      queueLimit: 0,              // Prevent connection queue buildup
      enableKeepAlive: true,      // Enable TCP keepalive
      keepAliveInitialDelay: 10000 // 10 seconds
    }
    
    logger.debug('Attempting to create connection pool with config:', {
      ...poolConfig,
      password: '[REDACTED]'
    })
    
    pool = createPool(poolConfig)
    
    // Test the connection with a simple query
    logger.debug('Testing connection with SELECT 1')
    try {
      await pool.query('SELECT 1')
      logger.info('Connection test successful')
    } catch (testError: any) {
      logger.error('Connection test failed:', { error: testError })
      throw testError
    }

    // Execute query based on operation
    const { operation, query, params, options } = body
    logger.debug('Executing query:', { operation, query, params, options })

    // Validate SQL query before execution
    validateSQLQuery(query)

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
        // Additional validation for execute operation
        if (!query.trim()) {
          throw new Error('Empty query is not allowed')
        }
        result = await pool.query(query, params)
        return NextResponse.json({ result })
      
      default:
        throw new Error(`Unsupported operation: ${operation}`)
    }
  } catch (error: any) {
    logger.error('Error during execution:', {
      name: error.name,
      message: error.message,
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage
    })
    
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
  } finally {
    // Always close the pool in the finally block
    if (pool) {
      try {
        await pool.end()
        logger.info('Connection pool closed')
      } catch (error) {
        logger.error('Error closing pool:', { error })
      }
    }
  }
} 