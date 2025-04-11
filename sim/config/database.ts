import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('Database Config')

// Database connection configurations
export interface DatabaseConfig {
  host: string
  port: number
  user: string
  password: string
  database: string
  ssl: boolean
}

// Get MySQL configuration from environment variables
export function getMySQLConfig(): DatabaseConfig | null {
  try {
    // Check if MYSQL_URL is provided
    const mysqlUrl = process.env.MYSQL_URL
    
    if (mysqlUrl) {
      // Parse MySQL URL (format: mysql://user:password@host:port/database)
      const url = new URL(mysqlUrl)
      const auth = url.username ? url.username.split(':') : []
      const user = auth[0] || ''
      const password = auth[1] || ''
      const host = url.hostname || ''
      const port = parseInt(url.port || '3306')
      const database = url.pathname.substring(1) || ''
      
      return {
        host,
        port,
        user,
        password,
        database,
        ssl: url.searchParams.get('ssl') === 'true'
      }
    }
    
    // Check for individual environment variables
    if (process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_PASSWORD && process.env.MYSQL_DATABASE) {
      return {
        host: process.env.MYSQL_HOST,
        port: parseInt(process.env.MYSQL_PORT || '3306'),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        ssl: process.env.MYSQL_SSL === 'true'
      }
    }
    
    return null
  } catch (error) {
    logger.error('Error parsing MySQL configuration:', error)
    return null
  }
}

// Get PostgreSQL configuration from environment variables
export function getPostgreSQLConfig(): DatabaseConfig | null {
  try {
    // Check if DATABASE_URL is provided
    const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL
    
    if (databaseUrl) {
      // Parse PostgreSQL URL (format: postgresql://user:password@host:port/database)
      const url = new URL(databaseUrl)
      const auth = url.username ? url.username.split(':') : []
      const user = auth[0] || ''
      const password = auth[1] || ''
      const host = url.hostname || ''
      const port = parseInt(url.port || '5432')
      const database = url.pathname.substring(1) || ''
      
      return {
        host,
        port,
        user,
        password,
        database,
        ssl: url.searchParams.get('ssl') === 'true'
      }
    }
    
    // Check for individual environment variables
    if (process.env.POSTGRES_HOST && process.env.POSTGRES_USER && process.env.POSTGRES_PASSWORD && process.env.POSTGRES_DB) {
      return {
        host: process.env.POSTGRES_HOST,
        port: parseInt(process.env.POSTGRES_PORT || '5432'),
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
        database: process.env.POSTGRES_DB,
        ssl: process.env.POSTGRES_SSL === 'true'
      }
    }
    
    return null
  } catch (error) {
    logger.error('Error parsing PostgreSQL configuration:', error)
    return null
  }
} 