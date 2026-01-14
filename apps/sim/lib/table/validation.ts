import type { ColumnType } from './constants'
import { COLUMN_TYPES, NAME_PATTERN, TABLE_LIMITS } from './constants'

export interface ColumnDefinition {
  name: string
  type: ColumnType
  required?: boolean
  unique?: boolean
}

export interface TableSchema {
  columns: ColumnDefinition[]
}

interface ValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Validates table name against naming rules
 */
export function validateTableName(name: string): ValidationResult {
  const errors: string[] = []

  if (!name || typeof name !== 'string') {
    errors.push('Table name is required')
    return { valid: false, errors }
  }

  if (name.length > TABLE_LIMITS.MAX_TABLE_NAME_LENGTH) {
    errors.push(
      `Table name exceeds maximum length (${TABLE_LIMITS.MAX_TABLE_NAME_LENGTH} characters)`
    )
  }

  if (!NAME_PATTERN.test(name)) {
    errors.push(
      'Table name must start with letter or underscore, followed by alphanumeric or underscore'
    )
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Validates column definition
 */
export function validateColumnDefinition(column: ColumnDefinition): ValidationResult {
  const errors: string[] = []

  if (!column.name || typeof column.name !== 'string') {
    errors.push('Column name is required')
    return { valid: false, errors }
  }

  if (column.name.length > TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH) {
    errors.push(
      `Column name "${column.name}" exceeds maximum length (${TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH} characters)`
    )
  }

  if (!NAME_PATTERN.test(column.name)) {
    errors.push(
      `Column name "${column.name}" must start with letter or underscore, followed by alphanumeric or underscore`
    )
  }

  if (!COLUMN_TYPES.includes(column.type)) {
    errors.push(
      `Column "${column.name}" has invalid type "${column.type}". Valid types: ${COLUMN_TYPES.join(', ')}`
    )
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Validates table schema
 */
export function validateTableSchema(schema: TableSchema): ValidationResult {
  const errors: string[] = []

  if (!schema || typeof schema !== 'object') {
    errors.push('Schema is required')
    return { valid: false, errors }
  }

  if (!Array.isArray(schema.columns)) {
    errors.push('Schema must have columns array')
    return { valid: false, errors }
  }

  if (schema.columns.length === 0) {
    errors.push('Schema must have at least one column')
  }

  if (schema.columns.length > TABLE_LIMITS.MAX_COLUMNS_PER_TABLE) {
    errors.push(`Schema exceeds maximum columns (${TABLE_LIMITS.MAX_COLUMNS_PER_TABLE})`)
  }

  // Validate each column
  for (const column of schema.columns) {
    const columnResult = validateColumnDefinition(column)
    errors.push(...columnResult.errors)
  }

  // Check for duplicate column names
  const columnNames = schema.columns.map((c) => c.name.toLowerCase())
  const uniqueNames = new Set(columnNames)
  if (uniqueNames.size !== columnNames.length) {
    errors.push('Duplicate column names found')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Validates row size
 */
export function validateRowSize(data: Record<string, any>): ValidationResult {
  const size = JSON.stringify(data).length
  if (size > TABLE_LIMITS.MAX_ROW_SIZE_BYTES) {
    return {
      valid: false,
      errors: [`Row size exceeds limit (${size} bytes > ${TABLE_LIMITS.MAX_ROW_SIZE_BYTES} bytes)`],
    }
  }
  return { valid: true, errors: [] }
}

/**
 * Validates row data against schema
 */
export function validateRowAgainstSchema(
  data: Record<string, any>,
  schema: TableSchema
): ValidationResult {
  const errors: string[] = []

  for (const column of schema.columns) {
    const value = data[column.name]

    // Check required fields
    if (column.required && (value === undefined || value === null)) {
      errors.push(`Missing required field: ${column.name}`)
      continue
    }

    // Skip type validation if value is null/undefined for optional fields
    if (value === null || value === undefined) continue

    // Type validation
    switch (column.type) {
      case 'string':
        if (typeof value !== 'string') {
          errors.push(`${column.name} must be string, got ${typeof value}`)
        } else if (value.length > TABLE_LIMITS.MAX_STRING_VALUE_LENGTH) {
          errors.push(`${column.name} exceeds max string length`)
        }
        break
      case 'number':
        if (typeof value !== 'number' || Number.isNaN(value)) {
          errors.push(`${column.name} must be number`)
        }
        break
      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push(`${column.name} must be boolean`)
        }
        break
      case 'date':
        if (!(value instanceof Date) && Number.isNaN(Date.parse(value))) {
          errors.push(`${column.name} must be valid date`)
        }
        break
      case 'json':
        try {
          JSON.stringify(value)
        } catch {
          errors.push(`${column.name} must be valid JSON`)
        }
        break
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Gets unique column definitions from schema
 */
export function getUniqueColumns(schema: TableSchema): ColumnDefinition[] {
  return schema.columns.filter((col) => col.unique === true)
}

/**
 * Validates unique constraints for row data
 * Checks if values for unique columns would violate uniqueness
 */
export function validateUniqueConstraints(
  data: Record<string, any>,
  schema: TableSchema,
  existingRows: Array<{ id: string; data: Record<string, any> }>,
  excludeRowId?: string
): ValidationResult {
  const errors: string[] = []
  const uniqueColumns = getUniqueColumns(schema)

  for (const column of uniqueColumns) {
    const value = data[column.name]

    // Skip null/undefined values for optional unique columns
    if (value === null || value === undefined) {
      continue
    }

    // Check if value exists in other rows
    const duplicate = existingRows.find((row) => {
      // Skip the row being updated
      if (excludeRowId && row.id === excludeRowId) {
        return false
      }

      // Check if value matches (case-insensitive for strings)
      const existingValue = row.data[column.name]
      if (typeof value === 'string' && typeof existingValue === 'string') {
        return value.toLowerCase() === existingValue.toLowerCase()
      }
      return value === existingValue
    })

    if (duplicate) {
      errors.push(
        `Column "${column.name}" must be unique. Value "${value}" already exists in row ${duplicate.id}`
      )
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
