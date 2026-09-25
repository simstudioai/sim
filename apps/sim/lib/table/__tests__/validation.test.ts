import { describe, expect, it } from 'vitest'
import { TABLE_LIMITS } from '@/lib/table/constants'
import {
  type ColumnDefinition,
  coerceRowToSchema,
  coerceRowValues,
  type TableSchema,
  validateColumnDefinition,
  validateRowAgainstSchema,
  validateRowSize,
  validateTableName,
  validateTableSchema,
  validateUniqueConstraints,
} from '@/lib/table/validation'

describe('Validation', () => {
  describe('validateTableName', () => {
    it('should reject names exceeding max length', () => {
      const longName = 'a'.repeat(TABLE_LIMITS.MAX_TABLE_NAME_LENGTH + 1)
      const result = validateTableName(longName)
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('exceeds maximum length')
    })
  })

  describe('validateColumnDefinition', () => {
    it('rejects select-only fields on a non-select column', () => {
      // Both are inert on a string column, but `updateColumnType` inherits them
      // on a later convert-to-select — options would be silently replaced and
      // `multiple` would turn an intended single-select into a multiselect.
      const withOptions = validateColumnDefinition({
        name: 'status',
        type: 'string',
        options: [{ id: 'opt_a', name: 'Open' }],
      })
      expect(withOptions.valid).toBe(false)
      expect(withOptions.errors[0]).toContain('cannot define options')

      const withMultiple = validateColumnDefinition({
        name: 'status',
        type: 'string',
        multiple: true,
      })
      expect(withMultiple.valid).toBe(false)
      expect(withMultiple.errors[0]).toContain('cannot be multiple')
    })
  })

  describe('validateColumnDefinition — currency', () => {
    const base: ColumnDefinition = { name: 'price', type: 'currency' }

    it('rejects a code no runtime can format', () => {
      const result = validateColumnDefinition({ ...base, currencyCode: 'ZZZ' })
      expect(result.valid).toBe(false)
      expect(result.errors.join(' ')).toContain('invalid currency code')
    })

    it('rejects a currency code stashed on a non-currency column', () => {
      const result = validateColumnDefinition({
        name: 'price',
        type: 'number',
        currencyCode: 'USD',
      })
      expect(result.valid).toBe(false)
      expect(result.errors.join(' ')).toContain('cannot define a currency')
    })
  })

  describe('validateTableSchema', () => {
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

    it('rejects more than one TTL column', () => {
      const result = validateTableSchema({
        columns: [
          { name: 'expires_at', type: 'ttl' },
          { name: 'delete_at', type: 'ttl' },
        ],
      } as TableSchema)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('A table can have at most 1 Expiration column')
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
    it('should reject row exceeding size limit', () => {
      const largeString = 'a'.repeat(TABLE_LIMITS.MAX_ROW_SIZE_BYTES + 1)
      const data = { content: largeString }
      const result = validateRowSize(data)
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('exceeds limit')
    })

    it('should measure UTF-8 bytes, not UTF-16 code units', () => {
      // '工' is one UTF-16 code unit but three UTF-8 bytes — a char-count check
      // would accept this row at ~1/3 of the real serialized size.
      const chars = Math.ceil(TABLE_LIMITS.MAX_ROW_SIZE_BYTES / 3) + 1
      const result = validateRowSize({ content: '工'.repeat(chars) })
      expect(result.valid).toBe(false)
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

    it('should reject missing required field', () => {
      const data = { age: 30 }
      const result = validateRowAgainstSchema(data, schema)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Missing required field: name')
    })

    it('should reject NaN for number field', () => {
      const data = { name: 'John', age: Number.NaN }
      const result = validateRowAgainstSchema(data, schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('must be number')
    })
  })

  describe('coerceRowToSchema', () => {
    const schema: TableSchema = {
      columns: [
        { name: 'name', type: 'string', required: true },
        { name: 'age', type: 'number' },
        { name: 'founded', type: 'number', required: true },
        { name: 'active', type: 'boolean' },
        { name: 'created', type: 'date' },
        { name: 'metadata', type: 'json' },
      ],
    }

    it('rejects an un-coercible value for an optional number column under `reject`', () => {
      const data = { name: 'Acme', founded: 2000, age: 'unknown' }
      const result = coerceRowToSchema(data, schema, 'reject')
      expect(result.valid).toBe(false)
    })

    it('nulls an un-coercible optional value by default', () => {
      const data = { name: 'Acme', founded: 2000, age: 'unknown' }
      const result = coerceRowToSchema(data, schema)
      expect(result.valid).toBe(true)
      expect(data.age).toBeNull()
    })

    it('rejects an un-coercible value for a required number column', () => {
      const data = { name: 'Acme', founded: 'unknown' }
      const result = coerceRowToSchema(data, schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('founded must be number')
      expect(data.founded).toBe('unknown')
    })

    it('refuses a bare epoch number under `reject`, whose unit the value cannot state', () => {
      const data = { name: 'Acme', founded: 2000, created: Date.parse('2024-01-15T00:00:00Z') }
      const result = coerceRowToSchema(data, schema, 'reject')
      expect(result.valid).toBe(false)
    })

    it('coerces an epoch number to an ISO date string by default', () => {
      const epoch = Date.parse('2024-01-15T00:00:00Z')
      const data = { name: 'Acme', founded: 2000, created: epoch }
      const result = coerceRowToSchema(data, schema)
      expect(result.valid).toBe(true)
      expect(data.created).toBe(new Date(epoch).toISOString())
    })

    it('nulls an out-of-range epoch number without throwing', () => {
      const data = { name: 'Acme', founded: 2000, created: 1e20 }
      const result = coerceRowToSchema(data, schema)
      expect(result.valid).toBe(true)
      expect(data.created).toBeNull()
    })

    it('nulls an invalid Date instance without throwing', () => {
      const data = { name: 'Acme', founded: 2000, created: new Date('not-a-date') }
      const result = coerceRowToSchema(data, schema)
      expect(result.valid).toBe(true)
      expect(data.created).toBeNull()
    })
  })

  describe('coerceRowValues', () => {
    const schema: TableSchema = {
      columns: [
        { name: 'name', type: 'string', required: true },
        { name: 'founded', type: 'number', required: true },
        { name: 'age', type: 'number' },
      ],
    }

    it('coerces a partial patch in place without flagging absent required fields', () => {
      const patch = { age: '42' }
      coerceRowValues(patch, schema)
      expect(patch.age).toBe(42)
    })

    it('leaves an un-coercible optional patch value in place under `reject`', () => {
      const patch: { age: unknown } = { age: 'nope' }
      coerceRowValues(patch as never, schema, 'reject')
      expect(patch.age).toBe('nope')
    })

    it('nulls an un-coercible optional patch value by default', () => {
      const patch: { age: unknown } = { age: 'nope' }
      coerceRowValues(patch as never, schema)
      expect(patch.age).toBeNull()
    })

    it('leaves an un-coercible required value in place for downstream validation', () => {
      const patch: { founded: unknown } = { founded: 'nope' }
      coerceRowValues(patch as never, schema)
      expect(patch.founded).toBe('nope')
    })

    describe('select coercion', () => {
      const selectSchema: TableSchema = {
        columns: [
          {
            id: 'status',
            name: 'status',
            type: 'select',
            options: [
              { id: 'opt_open', name: 'Open' },
              { id: 'opt_closed', name: 'Closed' },
            ],
          },
          {
            id: 'tags',
            name: 'tags',
            type: 'select',
            multiple: true,
            options: [
              { id: 'opt_a', name: 'Alpha' },
              { id: 'opt_b', name: 'Beta' },
            ],
          },
        ],
      }

      it('resolves a single-select name to its id', () => {
        const patch: Record<string, unknown> = { status: 'Open' }
        coerceRowValues(patch as never, selectSchema)
        expect(patch.status).toBe('opt_open')
      })

      it('splits a comma-delimited multiselect string into resolved ids', () => {
        const patch: Record<string, unknown> = { tags: 'Alpha, Beta' }
        coerceRowValues(patch as never, selectSchema)
        expect(patch.tags).toEqual(['opt_a', 'opt_b'])
      })

      it('resolves a multiselect array of names to ids and dedupes', () => {
        const patch: Record<string, unknown> = { tags: ['Alpha', 'opt_a', 'Beta'] }
        coerceRowValues(patch as never, selectSchema)
        expect(patch.tags).toEqual(['opt_a', 'opt_b'])
      })
    })

    describe('currency coercion', () => {
      const currencySchema: TableSchema = {
        columns: [
          { id: 'price', name: 'price', type: 'currency', currencyCode: 'USD' },
          { id: 'cost', name: 'cost', type: 'currency', currencyCode: 'EUR', required: true },
        ],
      }

      it('parses a formatted amount down to a bare number', () => {
        const patch: Record<string, unknown> = { price: '$1,234.56' }
        coerceRowValues(patch as never, currencySchema)
        expect(patch.price).toBe(1234.56)
      })

      it('leaves an unreadable amount in place on an optional column under `reject`', () => {
        const patch: Record<string, unknown> = { price: 'ask sales' }
        coerceRowValues(patch as never, currencySchema, 'reject')
        expect(patch.price).toBe('ask sales')
      })

      it('nulls an unreadable amount on an optional column by default', () => {
        const patch: Record<string, unknown> = { price: 'ask sales' }
        coerceRowValues(patch as never, currencySchema)
        expect(patch.price).toBeNull()
      })

      it('leaves an unreadable amount in place on a required column so validation reports it', () => {
        const patch: Record<string, unknown> = { cost: 'ask sales' }
        coerceRowValues(patch as never, currencySchema)
        expect(patch.cost).toBe('ask sales')
        expect(validateRowAgainstSchema(patch as never, currencySchema).valid).toBe(false)
      })
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

    it('should reject duplicate unique value', () => {
      const data = { id: 'abc123', email: 'new@example.com', name: 'New User' }
      const result = validateUniqueConstraints(data, schema, existingRows)
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('must be unique')
      expect(result.errors[0]).toContain('abc123')
    })

    it('should be case-sensitive for string comparisons', () => {
      // U333 vs u333: differing case is a DISTINCT value (matches the DB
      // containment leaf). This is the v2 contract that fixes the upsert wedge.
      const data = { id: 'ABC123', email: 'new@example.com', name: 'New User' }
      const result = validateUniqueConstraints(data, schema, existingRows)
      expect(result.valid).toBe(true)
    })

    it('compares expiration uniqueness by instant while retaining microseconds', () => {
      const expirationSchema: TableSchema = {
        columns: [{ name: 'expires', type: 'ttl', unique: true }],
      }
      const rows = [{ id: 'existing', data: { expires: '2026-09-07T07:30:00.000001-07:00' } }]
      for (const value of [
        '2026-09-07T14:30:00.000001Z',
        '2026-09-07T20:15:00.000001+05:45',
        '2026-09-07T14:30:00.000001-00:00',
      ]) {
        expect(validateUniqueConstraints({ expires: value }, expirationSchema, rows).valid).toBe(
          false
        )
        expect(
          validateUniqueConstraints({ expires: value }, expirationSchema, rows, 'existing').valid
        ).toBe(true)
      }
      expect(
        validateUniqueConstraints(
          { expires: '2026-09-07T14:30:00.000002-00:00' },
          expirationSchema,
          rows
        ).valid
      ).toBe(true)
    })

    it('should report multiple violations', () => {
      const data = { id: 'abc123', email: 'john@example.com', name: 'New User' }
      const result = validateUniqueConstraints(data, schema, existingRows)
      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(2)
    })
  })
})
