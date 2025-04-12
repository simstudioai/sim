import { Pool, FieldDef } from 'pg'
import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { getPostgreSQLConfig } from '@/config/database'

const logger = createLogger('PostgreSQLAPI')

export async function POST(request: Request) {
  let pool: Pool | null = null
  
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
      const envConfig = getPostgreSQLConfig()
      if (envConfig) {
        connection = {
          ...connection,
          host: connection.host || envConfig.host,
          port: connection.port || envConfig.port,
          user: connection.user || envConfig.user || 'postgres',
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

    // Create PostgreSQL connection pool with proper SSL configuration for RDS
    logger.info('Creating connection pool with config:', {
      ...connection,
      password: '[REDACTED]'
    })
    
    pool = new Pool({
      host: connection.host,
      port: typeof connection.port === 'string' ? parseInt(connection.port, 10) : (connection.port || 5432),
      user: connection.user || connection.username || 'postgres',
      password: connection.password,
      database: connection.database,
      ssl: connection.ssl === 'true' || connection.ssl === true ? {
        rejectUnauthorized: false,
        requestCert: true
      } : undefined,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      max: 20
    })

    // Test connection
    logger.debug('Testing connection...')
    try {
      await pool.query('SELECT 1')
      logger.info('Connection test successful')
    } catch (error: any) {
      logger.error('Connection test failed:', { error })
      throw error
    }

    // Execute query based on operation
    const { operation, query, params: queryParams, options } = body
    logger.debug('Executing query:', { operation, query, queryParams, options })

    // Query validation and security checks
    if (!query || typeof query !== 'string') {
      throw new Error('Query must be a non-empty string')
    }

    const normalizedQuery = query.trim().toLowerCase()
    
    // Block dangerous operations
    const BLOCKED_KEYWORDS = [
      'drop',
      'truncate',
      'delete from',
      'alter',
      'create',
      'rename',
      'replace',
      'restore',
      'grant',
      'revoke',
      'vacuum',
      'reindex',
      'cluster',
      'notify',
      'explain',
      'listen',
      'unlisten',
      'load',
      'reset',
      'deallocate',
      'declare',
      'discard',
      'prepare'
    ]

    // Check for blocked keywords at the start of the query
    if (BLOCKED_KEYWORDS.some(keyword => normalizedQuery.startsWith(keyword))) {
      throw new Error('This type of query is not allowed for security reasons')
    }

    // Additional security checks
    // Allow semicolons at the end of queries but prevent multiple statements
    if (normalizedQuery.split(';').filter(stmt => stmt.trim().length > 0).length > 1) {
      throw new Error('Multiple statements are not allowed')
    }

    if (normalizedQuery.includes('--') || normalizedQuery.includes('/*')) {
      throw new Error('SQL comments are not allowed')
    }

    // Default limits for SELECT queries
    const DEFAULT_PAGE_SIZE = 100
    const MAX_PAGE_SIZE = 1000

    let result
    switch (operation?.toLowerCase()) {
      case 'select':
        // Validate SELECT query structure
        if (!normalizedQuery.includes('from')) {
          throw new Error('Invalid SELECT query: Missing FROM clause')
        }
        if (normalizedQuery.includes('information_schema') || normalizedQuery.includes('pg_')) {
          throw new Error('Access to system tables is restricted')
        }
        // Check for potentially expensive operations
        if (normalizedQuery.includes('cross join') || normalizedQuery.includes('full join')) {
          throw new Error('Cross joins and full joins are not allowed due to performance concerns')
        }

        // Parse pagination options
        const page = options?.page ? Math.max(1, parseInt(options.page)) : 1
        const pageSize = options?.pageSize ? Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(options.pageSize))) : DEFAULT_PAGE_SIZE
        const offset = (page - 1) * pageSize

        // Set query timeout first, then execute the main query
        await pool.query('SET statement_timeout = 30000')
        
        // Execute the main query with pagination
        const paginatedQuery = `${query.trim().replace(/;$/, '')} LIMIT $${(queryParams || []).length + 1} OFFSET $${(queryParams || []).length + 2}`
        const paginatedParams = [...(queryParams || []), pageSize, offset]

        // Execute count query separately
        const countQuery = `SELECT COUNT(*) as total FROM (${query.trim().replace(/;$/, '')}) AS subquery LIMIT 10000`
        
        // Execute queries in parallel
        const [dataResult, countResult] = await Promise.all([
          pool.query(paginatedQuery, paginatedParams),
          pool.query(countQuery, queryParams || [])
        ])

        return NextResponse.json({ 
          rows: dataResult.rows,
          fields: dataResult.fields?.map((field: FieldDef) => ({
            name: field.name,
            type: field.dataTypeID,
            format: field.format,
            tableID: field.tableID
          })),
          pagination: {
            page,
            pageSize,
            total: parseInt(countResult.rows[0].total),
            totalPages: Math.ceil(parseInt(countResult.rows[0].total) / pageSize)
          }
        })
      
      case 'insert':
        if (!normalizedQuery.includes('into')) {
          throw new Error('Invalid INSERT query: Missing INTO clause')
        }
        if (!normalizedQuery.includes('values') && !normalizedQuery.includes('select')) {
          throw new Error('Invalid INSERT query: Missing VALUES or SELECT clause')
        }
        // Set query timeout first, then execute the main query
        await pool.query('SET statement_timeout = 30000')
        result = await pool.query(query, queryParams || [])
        return NextResponse.json({ affectedRows: result.rowCount })
      
      case 'update':
        if (!normalizedQuery.includes('set')) {
          throw new Error('Invalid UPDATE query: Missing SET clause')
        }
        if (!normalizedQuery.includes('where')) {
          throw new Error('UPDATE queries must include a WHERE clause')
        }
        // Set query timeout first, then execute the main query
        await pool.query('SET statement_timeout = 30000')
        result = await pool.query(query, queryParams || [])
        return NextResponse.json({ affectedRows: result.rowCount })
      
      case 'delete':
        if (!normalizedQuery.includes('where')) {
          throw new Error('DELETE queries must include a WHERE clause')
        }
        // Set query timeout first, then execute the main query
        await pool.query('SET statement_timeout = 30000')
        result = await pool.query(query, queryParams || [])
        return NextResponse.json({ affectedRows: result.rowCount })
      
      case 'execute':
        throw new Error('Execute operation is disabled for security reasons')
      
      default:
        throw new Error(`Unsupported operation: ${operation}`)
    }
  } catch (error: any) {
    logger.error('Error during execution:', {
      name: error.name,
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint
    })
    
    // Handle specific PostgreSQL errors
    if (error.code === '28P01' || error.code === '28000') {
      return NextResponse.json(
        { error: 'Access denied. Please check your username and password.' },
        { status: 401 }
      )
    }
    
    if (error.code === 'ECONNREFUSED') {
      return NextResponse.json(
        { error: 'Could not connect to PostgreSQL server. Please check if the server is running and accessible.' },
        { status: 503 }
      )
    }
    
    if (error.code === '3D000') {
      return NextResponse.json(
        { error: 'Database does not exist.' },
        { status: 404 }
      )
    }
    
    if (error.code === '42P01') {
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