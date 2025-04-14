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

    // Create PostgreSQL connection pool with proper SSL configuration for RDS
    logger.info('Creating connection pool with config:', {
      ...connection,
      password: '[REDACTED]'
    })
    
    pool = new Pool({
      host: connection.host,
      port: typeof connection.port === 'string' ? parseInt(connection.port, 10) : (connection.port || 5432),
      user: connection.user || connection.username,
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

    let result
    switch (operation?.toLowerCase()) {
      case 'select':
        result = await pool.query(query, queryParams || [])
        return NextResponse.json({ 
          rows: result.rows,
          fields: result.fields?.map((field: FieldDef) => ({
            name: field.name,
            type: field.dataTypeID,
            format: field.format,
            tableID: field.tableID
          }))
        })
      
      case 'insert':
      case 'update':
      case 'delete':
        result = await pool.query(query, queryParams || [])
        return NextResponse.json({ affectedRows: result.rowCount })
      
      case 'execute':
        result = await pool.query(query, queryParams || [])
        return NextResponse.json({ 
          rows: result.rows,
          rowCount: result.rowCount,
          fields: result.fields
        })
      
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