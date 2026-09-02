import type { ValidationResult } from '@/lib/core/security/input-validation'
import { validateSqlWhereClause } from '@/lib/core/security/input-validation.server'
import type { OracleBindScalar } from '@/lib/internal/oracledb/schema'

interface ScannedSql {
  masked: string
  hasComment: boolean
  hasHint: boolean
  semicolonIndex?: number
  error?: string
}

export interface OracleBuiltStatement {
  sql: string
  binds: Record<string, OracleBindScalar | string>
}

const EXECUTE_STATEMENTS = new Set([
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE',
  'CREATE',
  'ALTER',
  'DROP',
  'EXPLAIN',
])

const DEFERRED_OBJECT_TYPES = new Set([
  'FUNCTION',
  'PROCEDURE',
  'PACKAGE',
  'TRIGGER',
  'TYPE',
  'JAVA',
])

// Re-run broad-predicate checks against Oracle's literal grammar. The shared
// validator accepts backslash-escaped quotes for other SQL dialects; Oracle
// treats the quote after a backslash as the end of the literal.
const ORACLE_WHERE_MASKED_PATTERNS = [
  /\b(\w+)\s*=\s*\1\b/i,
  /\b\d+(?:\.\d+)?\s*(?:=|==|<>|!=|<=|>=|<|>)\s*\d+(?:\.\d+)?\b/,
  /\bor\s+(?:true|false)\b/i,
  /\bor\s+\d+(?:\.\d+)?\b(?!\s*[=<>!+\-*/%])/i,
  /^\s*(?:\d+(?:\.\d+)?|true|false)\s*$/i,
] as const

function ddlObjectType(tokens: string[]): string | undefined {
  const statement = tokens[0]
  if (statement !== 'CREATE' && statement !== 'ALTER' && statement !== 'DROP') return undefined
  let index = 1
  if (statement === 'CREATE' && tokens[index] === 'OR' && tokens[index + 1] === 'REPLACE') {
    index += 2
  }
  while (
    tokens[index] === 'EDITIONABLE' ||
    tokens[index] === 'NONEDITIONABLE' ||
    tokens[index] === 'FORCE' ||
    tokens[index] === 'NOFORCE'
  ) {
    index += 1
  }
  if (
    statement === 'CREATE' &&
    tokens[index] === 'AND' &&
    (tokens[index + 1] === 'RESOLVE' || tokens[index + 1] === 'COMPILE')
  ) {
    index += 2
    if (tokens[index] === 'NOFORCE') index += 1
  }
  return tokens[index]
}

function closingDelimiter(opening: string): string {
  return ({ '[': ']', '{': '}', '(': ')', '<': '>' } as Record<string, string>)[opening] ?? opening
}

function scanOracleSql(sql: string): ScannedSql {
  const masked = sql.split('')
  let hasComment = false
  let hasHint = false
  let semicolonIndex: number | undefined

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]
    const next = sql[index + 1]

    if (
      (character === 'q' || character === 'Q') &&
      next === "'" &&
      index + 2 < sql.length &&
      (index === 0 || !/[A-Za-z0-9_$#]/.test(sql[index - 1]))
    ) {
      const ending = `${closingDelimiter(sql[index + 2])}'`
      const endIndex = sql.indexOf(ending, index + 3)
      if (endIndex === -1)
        return { masked: '', hasComment, hasHint, error: 'Unterminated q-quoted string' }
      for (let cursor = index; cursor < endIndex + 2; cursor += 1) masked[cursor] = ' '
      index = endIndex + 1
      continue
    }

    if (character === "'") {
      masked[index] = ' '
      let closed = false
      for (let cursor = index + 1; cursor < sql.length; cursor += 1) {
        masked[cursor] = ' '
        if (sql[cursor] !== "'") continue
        if (sql[cursor + 1] === "'") {
          masked[cursor + 1] = ' '
          cursor += 1
          continue
        }
        index = cursor
        closed = true
        break
      }
      if (!closed) return { masked: '', hasComment, hasHint, error: 'Unterminated string literal' }
      continue
    }

    if (character === '"') {
      masked[index] = ' '
      let closed = false
      for (let cursor = index + 1; cursor < sql.length; cursor += 1) {
        masked[cursor] = ' '
        if (sql[cursor] !== '"') continue
        if (sql[cursor + 1] === '"') {
          masked[cursor + 1] = ' '
          cursor += 1
          continue
        }
        index = cursor
        closed = true
        break
      }
      if (!closed)
        return { masked: '', hasComment, hasHint, error: 'Unterminated quoted identifier' }
      continue
    }

    if (character === '-' && next === '-') {
      hasComment = true
      for (let cursor = index; cursor < sql.length && sql[cursor] !== '\n'; cursor += 1) {
        masked[cursor] = ' '
        index = cursor
      }
      continue
    }

    if (character === '/' && next === '*') {
      hasComment = true
      hasHint ||= sql[index + 2] === '+'
      const endIndex = sql.indexOf('*/', index + 2)
      if (endIndex === -1)
        return { masked: '', hasComment, hasHint, error: 'Unterminated block comment' }
      for (let cursor = index; cursor <= endIndex + 1; cursor += 1) masked[cursor] = ' '
      index = endIndex + 1
      continue
    }

    if (character === ';') {
      if (semicolonIndex !== undefined) {
        return { masked: '', hasComment, hasHint, error: 'Only one SQL statement is allowed' }
      }
      semicolonIndex = index
    }
  }

  const maskedSql = masked.join('')
  if (semicolonIndex !== undefined && maskedSql.slice(semicolonIndex + 1).trim().length > 0) {
    return { masked: '', hasComment, hasHint, error: 'Only one SQL statement is allowed' }
  }
  return { masked: maskedSql, hasComment, hasHint, semicolonIndex }
}

function sqlTokens(masked: string): string[] {
  return Array.from(masked.matchAll(/[A-Za-z][A-Za-z0-9_$#]*/g), (match) => match[0].toUpperCase())
}

function invalid(error: string): ValidationResult {
  return { isValid: false, error }
}

export function normalizeOracleSql(sql: string): string {
  const scan = scanOracleSql(sql)
  if (scan.error) return sql.trim()
  if (scan.semicolonIndex === undefined) return sql.trim()
  return `${sql.slice(0, scan.semicolonIndex)}${sql.slice(scan.semicolonIndex + 1)}`.trim()
}

export function validateOracleReadOnlyQuery(sql: string): ValidationResult {
  const scan = scanOracleSql(sql)
  if (scan.error) return invalid(scan.error)
  if (scan.hasComment) {
    return invalid(
      scan.hasHint
        ? 'The Query operation does not allow Oracle hints'
        : 'The Query operation does not allow SQL comments'
    )
  }

  const tokens = sqlTokens(scan.masked)
  if (tokens[0] !== 'SELECT' && tokens[0] !== 'WITH') {
    return invalid('The Query operation accepts only SELECT statements and read-only CTEs')
  }
  if (tokens[0] === 'WITH' && !tokens.includes('SELECT')) {
    return invalid('A read-only CTE must end in a SELECT statement')
  }
  if (tokens[0] === 'WITH') {
    const effectfulTokens = new Set([
      'INSERT',
      'UPDATE',
      'DELETE',
      'MERGE',
      'CREATE',
      'ALTER',
      'DROP',
      'TRUNCATE',
      'COMMIT',
      'ROLLBACK',
      'CALL',
      'EXECUTE',
      'BEGIN',
      'DECLARE',
    ])
    const effectful = tokens.find((token) => effectfulTokens.has(token))
    if (effectful) return invalid(`Read-only CTEs cannot contain ${effectful}`)
  }
  if (tokens.some((token) => token === 'FUNCTION' || token === 'PROCEDURE')) {
    return invalid('Inline PL/SQL functions and procedures are not supported')
  }
  if (/\bFOR\s+UPDATE\b/i.test(scan.masked)) {
    return invalid('SELECT FOR UPDATE is not read-only')
  }
  if (/\.\s*(?:NEXTVAL|CURRVAL)\b/i.test(scan.masked)) {
    return invalid('Sequence NEXTVAL and CURRVAL are not supported by the Query operation')
  }
  if (scan.masked.includes('@')) {
    return invalid('Database links are not supported by the Query operation')
  }
  return { isValid: true }
}

export function validateOracleExecuteQuery(sql: string): ValidationResult {
  const scan = scanOracleSql(sql)
  if (scan.error) return invalid(scan.error)
  const tokens = sqlTokens(scan.masked)
  const first = tokens[0]
  if (!first || (first !== 'WITH' && !EXECUTE_STATEMENTS.has(first))) {
    return invalid(
      'Execute accepts one SELECT, INSERT, UPDATE, DELETE, MERGE, CREATE, ALTER, DROP, or EXPLAIN PLAN statement'
    )
  }
  if (first === 'WITH' && !tokens.includes('SELECT')) {
    return invalid('An Execute CTE must end in a SELECT statement')
  }
  if ((first === 'SELECT' || first === 'WITH') && /\bFOR\s+UPDATE\b/i.test(scan.masked)) {
    return invalid('SELECT FOR UPDATE is not supported because Execute SELECT runs read-only')
  }
  if (first === 'WITH' && tokens.some((token) => token === 'FUNCTION' || token === 'PROCEDURE')) {
    return invalid('Inline PL/SQL functions and procedures are not supported')
  }
  if (first === 'EXPLAIN' && tokens[1] !== 'PLAN') {
    return invalid('EXPLAIN must use Oracle EXPLAIN PLAN syntax')
  }
  const objectType = ddlObjectType(tokens)
  if (objectType && DEFERRED_OBJECT_TYPES.has(objectType)) {
    return invalid('Stored code, triggers, object types, and Java objects are deferred in v1')
  }
  if (/\bRETURNING\b[\s\S]*\bINTO\b/i.test(scan.masked)) {
    return invalid('RETURNING INTO and OUT binds are deferred in v1')
  }
  return { isValid: true }
}

export function getOracleStatementType(sql: string): string {
  const scan = scanOracleSql(sql)
  const first = sqlTokens(scan.masked)[0] ?? ''
  return first === 'WITH' ? 'SELECT' : first
}

function assertIdentifier(identifier: string, label: string): void {
  if (
    identifier.trim().length === 0 ||
    Buffer.byteLength(identifier, 'utf8') > 128 ||
    identifier.includes('\0')
  ) {
    throw new Error(`${label} must be a non-empty Oracle identifier of at most 128 bytes`)
  }
}

export function quoteOracleIdentifier(identifier: string, label = 'Identifier'): string {
  assertIdentifier(identifier, label)
  return `"${identifier.replaceAll('"', '""')}"`
}

function qualifiedTable(schema: string | undefined, table: string): string {
  const quotedTable = quoteOracleIdentifier(table, 'Table name')
  return schema ? `${quoteOracleIdentifier(schema, 'Schema name')}.${quotedTable}` : quotedTable
}

function bindableValue(value: unknown, column: string): OracleBindScalar | string {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'boolean') return String(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Column ${column} must contain a finite number`)
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      throw new Error(`Column ${column} contains a value that cannot be serialized as JSON`)
    }
  }
  throw new Error(`Column ${column} contains an unsupported value`)
}

export function validateOracleWhere(where: string): ValidationResult {
  const common = validateSqlWhereClause(where)
  if (!common.isValid) return common
  const scan = scanOracleSql(where)
  if (scan.error) return invalid(scan.error)
  if (scan.hasComment) return invalid('WHERE clause cannot contain SQL comments or hints')
  if (scan.semicolonIndex !== undefined) return invalid('WHERE clause cannot contain a semicolon')
  if (ORACLE_WHERE_MASKED_PATTERNS.some((pattern) => pattern.test(scan.masked))) {
    return invalid('WHERE clause contains a disallowed or always-true expression')
  }
  const forbidden = new Set([
    'INSERT',
    'UPDATE',
    'DELETE',
    'MERGE',
    'CREATE',
    'ALTER',
    'DROP',
    'TRUNCATE',
    'COMMIT',
    'ROLLBACK',
    'BEGIN',
    'DECLARE',
    'EXECUTE',
    'CALL',
    'SELECT',
    'WITH',
  ])
  const matched = sqlTokens(scan.masked).find((token) => forbidden.has(token))
  if (matched) return invalid(`WHERE clause cannot contain ${matched}`)
  if (scan.masked.includes('@')) return invalid('WHERE clause cannot contain a database link')
  return { isValid: true }
}

export function buildOracleInsert(
  schema: string | undefined,
  table: string,
  data: Record<string, unknown>
): OracleBuiltStatement {
  const entries = Object.entries(data)
  if (entries.length === 0) throw new Error('Data object cannot be empty')
  const binds: Record<string, OracleBindScalar | string> = {}
  const columns: string[] = []
  const placeholders: string[] = []

  entries.forEach(([column, value], index) => {
    const bind = `b${index + 1}`
    columns.push(quoteOracleIdentifier(column, 'Column name'))
    placeholders.push(`:${bind}`)
    binds[bind] = bindableValue(value, column)
  })

  return {
    sql: `INSERT INTO ${qualifiedTable(schema, table)} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
    binds,
  }
}

export function buildOracleUpdate(
  schema: string | undefined,
  table: string,
  data: Record<string, unknown>,
  where: string
): OracleBuiltStatement {
  const validation = validateOracleWhere(where)
  if (!validation.isValid) throw new Error(validation.error)
  const entries = Object.entries(data)
  if (entries.length === 0) throw new Error('Data object cannot be empty')
  const binds: Record<string, OracleBindScalar | string> = {}
  const assignments = entries.map(([column, value], index) => {
    const bind = `b${index + 1}`
    binds[bind] = bindableValue(value, column)
    return `${quoteOracleIdentifier(column, 'Column name')} = :${bind}`
  })
  return {
    sql: `UPDATE ${qualifiedTable(schema, table)} SET ${assignments.join(', ')} WHERE ${where.trim()}`,
    binds,
  }
}

export function buildOracleDelete(
  schema: string | undefined,
  table: string,
  where: string
): OracleBuiltStatement {
  const validation = validateOracleWhere(where)
  if (!validation.isValid) throw new Error(validation.error)
  return {
    sql: `DELETE FROM ${qualifiedTable(schema, table)} WHERE ${where.trim()}`,
    binds: {},
  }
}

export const oracleQueryInternals = {
  scanOracleSql,
}
