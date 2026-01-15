/**
 * @vitest-environment node
 *
 * Query Builder Unit Tests
 *
 * Tests for the table query builder utilities including filter and sort clause generation.
 */
import { describe, expect, it } from 'vitest'
import { buildFilterClause, buildSortClause } from './query-builder'
import type { QueryFilter } from './types'

describe('Query Builder', () => {
  describe('buildFilterClause', () => {
    const tableName = 'user_table_rows'

    it('should return undefined for empty filter', () => {
      const result = buildFilterClause({}, tableName)
      expect(result).toBeUndefined()
    })

    it('should handle simple equality filter', () => {
      const filter: QueryFilter = { name: 'John' }
      const result = buildFilterClause(filter, tableName)

      expect(result).toBeDefined()
    })

    it('should handle $eq operator', () => {
      const filter: QueryFilter = { status: { $eq: 'active' } }
      const result = buildFilterClause(filter, tableName)

      expect(result).toBeDefined()
    })

    it('should handle $ne operator', () => {
      const filter: QueryFilter = { status: { $ne: 'deleted' } }
      const result = buildFilterClause(filter, tableName)

      expect(result).toBeDefined()
    })

    it('should handle $gt operator', () => {
      const filter: QueryFilter = { age: { $gt: 18 } }
      const result = buildFilterClause(filter, tableName)

      expect(result).toBeDefined()
    })

    it('should handle $gte operator', () => {
      const filter: QueryFilter = { age: { $gte: 18 } }
      const result = buildFilterClause(filter, tableName)

      expect(result).toBeDefined()
    })

    it('should handle $lt operator', () => {
      const filter: QueryFilter = { age: { $lt: 65 } }
      const result = buildFilterClause(filter, tableName)

      expect(result).toBeDefined()
    })

    it('should handle $lte operator', () => {
      const filter: QueryFilter = { age: { $lte: 65 } }
      const result = buildFilterClause(filter, tableName)

      expect(result).toBeDefined()
    })

    it('should handle $in operator with single value', () => {
      const filter: QueryFilter = { status: { $in: ['active'] } }
      const result = buildFilterClause(filter, tableName)

      expect(result).toBeDefined()
    })

    it('should handle $in operator with multiple values', () => {
      const filter: QueryFilter = { status: { $in: ['active', 'pending'] } }
      const result = buildFilterClause(filter, tableName)

      expect(result).toBeDefined()
    })

    it('should handle $nin operator', () => {
      const filter: QueryFilter = { status: { $nin: ['deleted', 'archived'] } }
      const result = buildFilterClause(filter, tableName)

      expect(result).toBeDefined()
    })

    it('should handle $contains operator', () => {
      const filter: QueryFilter = { name: { $contains: 'john' } }
      const result = buildFilterClause(filter, tableName)

      expect(result).toBeDefined()
    })

    it('should handle $or logical operator', () => {
      const filter: QueryFilter = {
        $or: [{ status: 'active' }, { status: 'pending' }],
      }
      const result = buildFilterClause(filter, tableName)

      expect(result).toBeDefined()
    })

    it('should handle $and logical operator', () => {
      const filter: QueryFilter = {
        $and: [{ status: 'active' }, { age: { $gt: 18 } }],
      }
      const result = buildFilterClause(filter, tableName)

      expect(result).toBeDefined()
    })

    it('should handle multiple conditions combined with AND', () => {
      const filter: QueryFilter = {
        status: 'active',
        age: { $gt: 18 },
      }
      const result = buildFilterClause(filter, tableName)

      expect(result).toBeDefined()
    })

    it('should handle nested $or and $and', () => {
      const filter: QueryFilter = {
        $or: [{ $and: [{ status: 'active' }, { verified: true }] }, { role: 'admin' }],
      }
      const result = buildFilterClause(filter, tableName)

      expect(result).toBeDefined()
    })

    it('should throw error for invalid field name', () => {
      const filter: QueryFilter = { 'invalid-field': 'value' }

      expect(() => buildFilterClause(filter, tableName)).toThrow('Invalid field name')
    })

    it('should throw error for invalid operator', () => {
      const filter = { name: { $invalid: 'value' } } as unknown as QueryFilter

      expect(() => buildFilterClause(filter, tableName)).toThrow('Invalid operator')
    })

    it('should skip undefined values', () => {
      const filter: QueryFilter = { name: undefined, status: 'active' }
      const result = buildFilterClause(filter, tableName)

      expect(result).toBeDefined()
    })

    it('should handle boolean values', () => {
      const filter: QueryFilter = { active: true }
      const result = buildFilterClause(filter, tableName)

      expect(result).toBeDefined()
    })

    it('should handle null values', () => {
      const filter: QueryFilter = { deleted_at: null }
      const result = buildFilterClause(filter, tableName)

      expect(result).toBeDefined()
    })

    it('should handle numeric values', () => {
      const filter: QueryFilter = { count: 42 }
      const result = buildFilterClause(filter, tableName)

      expect(result).toBeDefined()
    })
  })

  describe('buildSortClause', () => {
    const tableName = 'user_table_rows'

    it('should return undefined for empty sort', () => {
      const result = buildSortClause({}, tableName)
      expect(result).toBeUndefined()
    })

    it('should handle single field ascending sort', () => {
      const sort = { name: 'asc' as const }
      const result = buildSortClause(sort, tableName)

      expect(result).toBeDefined()
    })

    it('should handle single field descending sort', () => {
      const sort = { name: 'desc' as const }
      const result = buildSortClause(sort, tableName)

      expect(result).toBeDefined()
    })

    it('should handle multiple fields sort', () => {
      const sort = { name: 'asc' as const, created_at: 'desc' as const }
      const result = buildSortClause(sort, tableName)

      expect(result).toBeDefined()
    })

    it('should handle createdAt field directly', () => {
      const sort = { createdAt: 'desc' as const }
      const result = buildSortClause(sort, tableName)

      expect(result).toBeDefined()
    })

    it('should handle updatedAt field directly', () => {
      const sort = { updatedAt: 'asc' as const }
      const result = buildSortClause(sort, tableName)

      expect(result).toBeDefined()
    })

    it('should throw error for invalid field name', () => {
      const sort = { 'invalid-field': 'asc' as const }

      expect(() => buildSortClause(sort, tableName)).toThrow('Invalid field name')
    })

    it('should throw error for invalid direction', () => {
      const sort = { name: 'invalid' as 'asc' | 'desc' }

      expect(() => buildSortClause(sort, tableName)).toThrow('Invalid sort direction')
    })
  })

  describe('Field Name Validation', () => {
    const tableName = 'user_table_rows'

    it('should accept valid field names', () => {
      const validNames = ['name', 'user_id', '_private', 'Count123', 'a']

      for (const name of validNames) {
        const filter: QueryFilter = { [name]: 'value' }
        expect(() => buildFilterClause(filter, tableName)).not.toThrow()
      }
    })

    it('should reject field names starting with number', () => {
      const filter: QueryFilter = { '123name': 'value' }
      expect(() => buildFilterClause(filter, tableName)).toThrow('Invalid field name')
    })

    it('should reject field names with special characters', () => {
      const invalidNames = ['field-name', 'field.name', 'field name', 'field@name']

      for (const name of invalidNames) {
        const filter: QueryFilter = { [name]: 'value' }
        expect(() => buildFilterClause(filter, tableName)).toThrow('Invalid field name')
      }
    })

    it('should reject SQL injection attempts', () => {
      const sqlInjectionAttempts = ["'; DROP TABLE users; --", 'name OR 1=1', 'name; DELETE FROM']

      for (const attempt of sqlInjectionAttempts) {
        const filter: QueryFilter = { [attempt]: 'value' }
        expect(() => buildFilterClause(filter, tableName)).toThrow('Invalid field name')
      }
    })
  })
})
