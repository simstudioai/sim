/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { TABLE_LIMITS } from './constants'
import {
  type ColumnDefinition,
  getUniqueColumns,
  type TableSchema,
  validateColumnDefinition,
  validateRowAgainstSchema,
  validateRowSize,
  validateTableName,
  validateTableSchema,
  validateUniqueConstraints,
} from './validation'

describe('Validation', () => {
  describe('validateTableName', () => {
    it('should accept valid table names', () => {
      const validNames = ['users', 'user_data', '_private', 'Users123', 'a']

      for (const name of validNames) {
        const result = validateTableName(name)
        expect(result.valid).toBe(true)
        expect(result.errors).toHaveLength(0)
      }
    })

    it('should reject empty name', () => {
      const result = validateTableName('')
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Table name is required')
    })

    it('should reject null/undefined name', () => {
      const result1 = validateTableName(null as unknown as string)
      expect(result1.valid).toBe(false)

      const result2 = validateTableName(undefined as unknown as string)
      expect(result2.valid).toBe(false)
    })

    it('should reject names starting with number', () => {
      const result = validateTableName('123table')
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('must start with letter or underscore')
    })

    it('should reject names with special characters', () => {
      const invalidNames = ['table-name', 'table.name', 'table name', 'table@name']

      for (const name of invalidNames) {
        const result = validateTableName(name)
        expect(result.valid).toBe(false)
      }
    })

    it('should reject names exceeding max length', () => {
      const longName = 'a'.repeat(TABLE_LIMITS.MAX_TABLE_NAME_LENGTH + 1)
      const result = validateTableName(longName)
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('exceeds maximum length')
    })
  })

  describe('validateColumnDefinition', () => {
    it('should accept valid column definition', () => {
      const column: ColumnDefinition = {
        name: 'email',
        type: 'string',
        required: true,
        unique: true,
      }
      const result = validateColumnDefinition(column)
      expect(result.valid).toBe(true)
    })

    it('should accept all valid column types', () => {
      const types = ['string', 'number', 'boolean', 'date', 'json'] as const

      for (const type of types) {
        const result = validateColumnDefinition({ name: 'test', type })
        expect(result.valid).toBe(true)
      }
    })

    it('should reject empty column name', () => {
      const result = validateColumnDefinition({ name: '', type: 'string' })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Column name is required')
    })

    it('should reject invalid column type', () => {
      const result = validateColumnDefinition({
        name: 'test',
        type: 'invalid' as any,
      })
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('invalid type')
    })

    it('should reject column name exceeding max length', () => {
      const longName = 'a'.repeat(TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH + 1)
      const result = validateColumnDefinition({ name: longName, type: 'string' })
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('exceeds maximum length')
    })
  })

  describe('validateTableSchema', () => {
    it('should accept valid schema', () => {
      const schema: TableSchema = {
        columns: [
          { name: 'id', type: 'string', required: true, unique: true },
          { name: 'name', type: 'string', required: true },
          { name: 'age', type: 'number' },
        ],
      }
      const result = validateTableSchema(schema)
      expect(result.valid).toBe(true)
    })

    it('should reject empty columns array', () => {
      const schema: TableSchema = { columns: [] }
      const result = validateTableSchema(schema)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Schema must have at least one column')
    })

    it('should reject duplicate column names', () => {
      const schema: TableSchema = {
        columns: [
          { name: 'id', type: 'string' },
          { name: 'ID', type: 'number' },
        ],
      }
      const result = validateTableSchema(schema)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Duplicate column names found')
    })

    it('should reject null schema', () => {
      const result = validateTableSchema(null as unknown as TableSchema)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Schema is required')
    })

    it('should reject schema without columns array', () => {
      const result = validateTableSchema({} as TableSchema)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Schema must have columns array')
    })

    it('should reject schema exceeding max columns', () => {
      const columns = Array.from({ length: TABLE_LIMITS.MAX_COLUMNS_PER_TABLE + 1 }, (_, i) => ({
        name: `col_${i}`,
        type: 'string' as const,
      }))
      const result = validateTableSchema({ columns })
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('exceeds maximum columns')
    })
  })

  describe('validateRowSize', () => {
    it('should accept row within size limit', () => {
      const data = { name: 'test', value: 123 }
      const result = validateRowSize(data)
      expect(result.valid).toBe(true)
    })

    it('should reject row exceeding size limit', () => {
      const largeString = 'a'.repeat(TABLE_LIMITS.MAX_ROW_SIZE_BYTES + 1)
      const data = { content: largeString }
      const result = validateRowSize(data)
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('exceeds limit')
    })
  })

  describe('validateRowAgainstSchema', () => {
    const schema: TableSchema = {
      columns: [
        { name: 'name', type: 'string', required: true },
        { name: 'age', type: 'number' },
        { name: 'active', type: 'boolean' },
        { name: 'created', type: 'date' },
        { name: 'metadata', type: 'json' },
      ],
    }

    it('should accept valid row data', () => {
      const data = {
        name: 'John',
        age: 30,
        active: true,
        created: '2024-01-01',
        metadata: { key: 'value' },
      }
      const result = validateRowAgainstSchema(data, schema)
      expect(result.valid).toBe(true)
    })

    it('should reject missing required field', () => {
      const data = { age: 30 }
      const result = validateRowAgainstSchema(data, schema)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Missing required field: name')
    })

    it('should reject wrong type for string field', () => {
      const data = { name: 123 }
      const result = validateRowAgainstSchema(data, schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('must be string')
    })

    it('should reject wrong type for number field', () => {
      const data = { name: 'John', age: 'thirty' }
      const result = validateRowAgainstSchema(data, schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('must be number')
    })

    it('should reject NaN for number field', () => {
      const data = { name: 'John', age: Number.NaN }
      const result = validateRowAgainstSchema(data, schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('must be number')
    })

    it('should reject wrong type for boolean field', () => {
      const data = { name: 'John', active: 'yes' }
      const result = validateRowAgainstSchema(data, schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('must be boolean')
    })

    it('should reject invalid date string', () => {
      const data = { name: 'John', created: 'not-a-date' }
      const result = validateRowAgainstSchema(data, schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('must be valid date')
    })

    it('should accept valid ISO date string', () => {
      const data = { name: 'John', created: '2024-01-15T10:30:00Z' }
      const result = validateRowAgainstSchema(data, schema)
      expect(result.valid).toBe(true)
    })

    it('should accept Date object', () => {
      const data = { name: 'John', created: new Date() }
      const result = validateRowAgainstSchema(data, schema)
      expect(result.valid).toBe(true)
    })

    it('should allow null for optional fields', () => {
      const data = { name: 'John', age: null }
      const result = validateRowAgainstSchema(data, schema)
      expect(result.valid).toBe(true)
    })

    it('should allow undefined for optional fields', () => {
      const data = { name: 'John' }
      const result = validateRowAgainstSchema(data, schema)
      expect(result.valid).toBe(true)
    })

    it('should reject string exceeding max length', () => {
      const longString = 'a'.repeat(TABLE_LIMITS.MAX_STRING_VALUE_LENGTH + 1)
      const data = { name: longString }
      const result = validateRowAgainstSchema(data, schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('exceeds max string length')
    })
  })

  describe('getUniqueColumns', () => {
    it('should return only columns with unique=true', () => {
      const schema: TableSchema = {
        columns: [
          { name: 'id', type: 'string', unique: true },
          { name: 'email', type: 'string', unique: true },
          { name: 'name', type: 'string' },
          { name: 'count', type: 'number', unique: false },
        ],
      }
      const result = getUniqueColumns(schema)
      expect(result).toHaveLength(2)
      expect(result.map((c) => c.name)).toEqual(['id', 'email'])
    })

    it('should return empty array when no unique columns', () => {
      const schema: TableSchema = {
        columns: [
          { name: 'name', type: 'string' },
          { name: 'value', type: 'number' },
        ],
      }
      const result = getUniqueColumns(schema)
      expect(result).toHaveLength(0)
    })
  })

  describe('validateUniqueConstraints', () => {
    const schema: TableSchema = {
      columns: [
        { name: 'id', type: 'string', unique: true },
        { name: 'email', type: 'string', unique: true },
        { name: 'name', type: 'string' },
      ],
    }

    const existingRows = [
      { id: 'row1', data: { id: 'abc123', email: 'john@example.com', name: 'John' } },
      { id: 'row2', data: { id: 'def456', email: 'jane@example.com', name: 'Jane' } },
    ]

    it('should accept data with unique values', () => {
      const data = { id: 'xyz789', email: 'new@example.com', name: 'New User' }
      const result = validateUniqueConstraints(data, schema, existingRows)
      expect(result.valid).toBe(true)
    })

    it('should reject duplicate unique value', () => {
      const data = { id: 'abc123', email: 'new@example.com', name: 'New User' }
      const result = validateUniqueConstraints(data, schema, existingRows)
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('must be unique')
      expect(result.errors[0]).toContain('abc123')
    })

    it('should be case-insensitive for string comparisons', () => {
      const data = { id: 'ABC123', email: 'new@example.com', name: 'New User' }
      const result = validateUniqueConstraints(data, schema, existingRows)
      expect(result.valid).toBe(false)
    })

    it('should exclude specified row from checks (for updates)', () => {
      const data = { id: 'abc123', email: 'john@example.com', name: 'John Updated' }
      const result = validateUniqueConstraints(data, schema, existingRows, 'row1')
      expect(result.valid).toBe(true)
    })

    it('should allow null values for unique columns', () => {
      const data = { id: null, email: 'new@example.com', name: 'New User' }
      const result = validateUniqueConstraints(data, schema, existingRows)
      expect(result.valid).toBe(true)
    })

    it('should allow undefined values for unique columns', () => {
      const data = { email: 'new@example.com', name: 'New User' }
      const result = validateUniqueConstraints(data, schema, existingRows)
      expect(result.valid).toBe(true)
    })

    it('should report multiple violations', () => {
      const data = { id: 'abc123', email: 'john@example.com', name: 'New User' }
      const result = validateUniqueConstraints(data, schema, existingRows)
      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(2)
    })
  })
})
