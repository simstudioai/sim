import { createLogger } from '@sim/logger'

const logger = createLogger('QuickBooksUtils')

/**
 * Allowed QuickBooks entity tables for query operations
 * Based on QuickBooks Query Language (QBL) specification
 */
const ALLOWED_ENTITIES = [
  'Account',
  'Bill',
  'BillPayment',
  'Customer',
  'Estimate',
  'Expense',
  'Purchase', // Used for expenses/purchases in QuickBooks
  'Invoice',
  'Payment',
  'Vendor',
  'Item',
  'TimeActivity',
  'Employee',
  'Department',
  'Class',
  'TaxCode',
  'TaxRate',
  'Term',
] as const

/**
 * Dangerous keywords that should never appear in QuickBooks queries
 * These are not part of QBL but we block them defensively
 */
const DANGEROUS_KEYWORDS = [
  'DROP',
  'DELETE',
  'INSERT',
  'UPDATE',
  'ALTER',
  'CREATE',
  'TRUNCATE',
  'EXEC',
  'EXECUTE',
  'SCRIPT',
  'UNION',
  'DECLARE',
] as const

/**
 * Dangerous patterns using regex to catch variations with whitespace
 */
const DANGEROUS_PATTERNS = [
  /--/,                           // SQL line comment
  /\/\s*\*/,                      // SQL block comment start (matches /* with optional whitespace)
  /\*\s*\//,                      // SQL block comment end (matches */ with optional whitespace)
  /;\s*(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|TRUNCATE)/i,  // Injection attempts
  /UNION\s+SELECT/i,             // UNION-based injection
  /;\s*EXEC/i,                   // Command execution
] as const

/**
 * Validates a QuickBooks Query Language (QBL) query string
 *
 * @param query - The query string to validate
 * @param expectedEntity - The expected entity table name (e.g., 'Bill', 'Customer')
 * @returns Validated query string
 * @throws Error if query is invalid or potentially malicious
 *
 * @example
 * ```typescript
 * const query = validateQuickBooksQuery(
 *   "SELECT * FROM Bill WHERE Balance > '0'",
 *   'Bill'
 * )
 * ```
 */
export function validateQuickBooksQuery(query: string, expectedEntity: string): string {
  if (!query || typeof query !== 'string') {
    throw new Error('Query must be a non-empty string')
  }

  const trimmedQuery = query.trim()

  // Queries must start with SELECT
  if (!trimmedQuery.toUpperCase().startsWith('SELECT')) {
    throw new Error('Query must start with SELECT')
  }

  // Check for dangerous keywords (case-insensitive)
  const upperQuery = trimmedQuery.toUpperCase()
  for (const keyword of DANGEROUS_KEYWORDS) {
    if (upperQuery.includes(keyword)) {
      logger.warn(`Blocked query with dangerous keyword: ${keyword}`, { query: trimmedQuery })
      throw new Error(`Query contains disallowed keyword: ${keyword}`)
    }
  }

  // Check for dangerous patterns (regex-based for whitespace variations)
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmedQuery)) {
      logger.warn(`Blocked query with dangerous pattern: ${pattern}`, { query: trimmedQuery })
      throw new Error(`Query contains disallowed pattern: ${pattern}`)
    }
  }

  // Validate only one FROM clause exists
  const fromMatches = trimmedQuery.match(/FROM\s+(\w+)/gi)
  if (!fromMatches || fromMatches.length !== 1) {
    throw new Error('Query must contain exactly one FROM clause')
  }

  // Extract the FROM clause entity
  const fromMatch = trimmedQuery.match(/FROM\s+(\w+)/i)
  if (!fromMatch) {
    throw new Error('Query must include a FROM clause')
  }

  // Normalize entity name for case-insensitive comparison
  const entityInQuery = fromMatch[1]
  const normalizedEntity =
    entityInQuery.charAt(0).toUpperCase() + entityInQuery.slice(1).toLowerCase()

  // Verify entity is in allowlist (case-insensitive)
  if (!ALLOWED_ENTITIES.includes(normalizedEntity as any)) {
    logger.warn(`Blocked query with unauthorized entity: ${entityInQuery}`, {
      query: trimmedQuery,
    })
    throw new Error(`Entity '${entityInQuery}' is not allowed in queries`)
  }

  // Verify entity matches expected entity for this tool (case-insensitive)
  if (normalizedEntity !== expectedEntity) {
    throw new Error(
      `Query entity '${entityInQuery}' does not match expected entity '${expectedEntity}'`
    )
  }

  // Check for multiple statements (semicolon)
  if (trimmedQuery.includes(';')) {
    throw new Error('Multiple statements are not allowed')
  }

  logger.info('Query validation successful', {
    entity: entityInQuery,
    queryLength: trimmedQuery.length,
  })

  return trimmedQuery
}

/**
 * Builds a safe default query for a QuickBooks entity
 *
 * @param entity - The entity table name
 * @param maxResults - Maximum number of results (optional)
 * @param startPosition - Starting position for pagination (optional)
 * @returns Safe default query string
 */
export function buildDefaultQuery(
  entity: string,
  maxResults?: number,
  startPosition?: number
): string {
  let query = `SELECT * FROM ${entity}`

  if (startPosition && startPosition > 1) {
    query += ` STARTPOSITION ${startPosition}`
  }

  if (maxResults && maxResults > 0) {
    query += ` MAXRESULTS ${maxResults}`
  }

  return query
}

/**
 * Adds pagination clauses to an existing QuickBooks query
 *
 * @param query - The base query
 * @param maxResults - Maximum number of results (optional)
 * @param startPosition - Starting position for pagination (optional)
 * @returns Query with pagination clauses added
 */
export function addPaginationToQuery(
  query: string,
  maxResults?: number,
  startPosition?: number
): string {
  let paginatedQuery = query.trim()

  // Remove existing MAXRESULTS and STARTPOSITION if present
  paginatedQuery = paginatedQuery.replace(/\s+MAXRESULTS\s+\d+/gi, '')
  paginatedQuery = paginatedQuery.replace(/\s+STARTPOSITION\s+\d+/gi, '')

  // Add pagination parameters
  if (startPosition && startPosition > 1) {
    paginatedQuery += ` STARTPOSITION ${startPosition}`
  }

  if (maxResults && maxResults > 0) {
    paginatedQuery += ` MAXRESULTS ${maxResults}`
  }

  return paginatedQuery
}
