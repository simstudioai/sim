import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('Snowflake Utils')

/**
 * Build the base Snowflake SQL API URL
 */
export function buildSnowflakeSQLAPIUrl(accountUrl: string): string {
  // Remove https:// if present
  const cleanUrl = accountUrl.replace(/^https?:\/\//, '')
  return `https://${cleanUrl}/api/v2/statements`
}

/**
 * Execute a Snowflake SQL statement
 */
export async function executeSnowflakeStatement(
  accountUrl: string,
  accessToken: string,
  query: string,
  options?: {
    database?: string
    schema?: string
    warehouse?: string
    role?: string
    timeout?: number
    async?: boolean
  }
): Promise<any> {
  const apiUrl = buildSnowflakeSQLAPIUrl(accountUrl)

  const requestBody: any = {
    statement: query,
    timeout: options?.timeout || 60,
  }

  if (options?.database) {
    requestBody.database = options.database
  }

  if (options?.schema) {
    requestBody.schema = options.schema
  }

  if (options?.warehouse) {
    requestBody.warehouse = options.warehouse
  }

  if (options?.role) {
    requestBody.role = options.role
  }

  if (options?.async) {
    requestBody.async = true
  }

  logger.info('Executing Snowflake statement', {
    accountUrl,
    hasAccessToken: !!accessToken,
    database: options?.database,
    schema: options?.schema,
  })

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'X-Snowflake-Authorization-Token-Type': 'PROGRAMMATIC_ACCESS_TOKEN',
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error('Snowflake API error', {
      status: response.status,
      statusText: response.statusText,
      errorText,
    })
    throw new Error(`Snowflake API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  logger.info('Snowflake statement executed successfully')

  return data
}

/**
 * Parse Snowflake account URL to ensure proper format
 */
export function parseAccountUrl(accountUrl: string): string {
  // Remove protocol if present
  let cleanUrl = accountUrl.replace(/^https?:\/\//, '')

  // Remove trailing slash if present
  cleanUrl = cleanUrl.replace(/\/$/, '')

  // If it doesn't contain snowflakecomputing.com, append it
  if (!cleanUrl.includes('snowflakecomputing.com')) {
    cleanUrl = `${cleanUrl}.snowflakecomputing.com`
  }

  return cleanUrl
}

/**
 * Extract data from Snowflake API response
 */
export function extractResponseData(response: any): any[] {
  if (!response.data || response.data.length === 0) {
    return []
  }

  const rows: any[] = []

  for (const row of response.data) {
    const rowData: any = {}
    for (let i = 0; i < row.length; i++) {
      const columnName = response.resultSetMetaData?.rowType?.[i]?.name || `column_${i}`
      rowData[columnName] = row[i]
    }
    rows.push(rowData)
  }

  return rows
}

/**
 * Extract column metadata from Snowflake API response
 */
export function extractColumnMetadata(response: any): Array<{ name: string; type: string }> {
  if (!response.resultSetMetaData?.rowType) {
    return []
  }

  return response.resultSetMetaData.rowType.map((col: any) => ({
    name: col.name,
    type: col.type,
  }))
}

export function sanitizeIdentifier(identifier: string): string {
  if (identifier.includes('.')) {
    const parts = identifier.split('.')
    return parts.map((part) => sanitizeSingleIdentifier(part)).join('.')
  }

  return sanitizeSingleIdentifier(identifier)
}

export function validateWhereClause(where: string): void {
  const dangerousPatterns = [
    /;\s*(drop|delete|insert|update|create|alter|grant|revoke|truncate)/i,
    /union\s+select/i,
    /into\s+outfile/i,
    /load_file/i,
    /--/,
    /\/\*/,
    /\*\//,
    /xp_cmdshell/i,
    /exec\s*\(/i,
    /execute\s+immediate/i,
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(where)) {
      throw new Error('WHERE clause contains potentially dangerous operation')
    }
  }
}

function sanitizeSingleIdentifier(identifier: string): string {
  const cleaned = identifier.replace(/"/g, '')

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cleaned)) {
    throw new Error(
      `Invalid identifier: ${identifier}. Identifiers must start with a letter or underscore and contain only letters, numbers, and underscores.`
    )
  }

  return `"${cleaned}"`
}
