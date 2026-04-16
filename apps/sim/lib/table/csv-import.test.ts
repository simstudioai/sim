/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildAutoMapping,
  CsvImportValidationError,
  coerceRowsForTable,
  coerceValue,
  inferColumnType,
  inferSchemaFromCsv,
  parseCsvBuffer,
  sanitizeName,
  validateMapping,
} from '@/lib/table/csv-import'
import type { TableSchema } from '@/lib/table/types'

describe('csv-import', () => {
  describe('parseCsvBuffer', () => {
    it('parses a CSV string and extracts headers', async () => {
      const { headers, rows } = await parseCsvBuffer('a,b\n1,2\n3,4')
      expect(headers).toEqual(['a', 'b'])
      expect(rows).toEqual([
        { a: '1', b: '2' },
        { a: '3', b: '4' },
      ])
    })

    it('strips a UTF-8 BOM from the first header', async () => {
      const text = `\uFEFFname,age\nAlice,30`
      const { headers } = await parseCsvBuffer(text)
      expect(headers).toEqual(['name', 'age'])
    })

    it('parses a Uint8Array input in browser-like environments', async () => {
      const bytes = new TextEncoder().encode('a,b\n1,2')
      const { headers, rows } = await parseCsvBuffer(bytes)
      expect(headers).toEqual(['a', 'b'])
      expect(rows).toHaveLength(1)
    })

    it('parses TSV when delimiter is tab', async () => {
      const { headers, rows } = await parseCsvBuffer('a\tb\n1\t2', '\t')
      expect(headers).toEqual(['a', 'b'])
      expect(rows).toEqual([{ a: '1', b: '2' }])
    })

    it('throws when the file has no data rows', async () => {
      await expect(parseCsvBuffer('a,b')).rejects.toThrow(/no data rows/i)
    })
  })

  describe('inferColumnType', () => {
    it('returns "string" for empty samples', () => {
      expect(inferColumnType([])).toBe('string')
      expect(inferColumnType([null, undefined, ''])).toBe('string')
    })

    it('detects numeric columns', () => {
      expect(inferColumnType(['1', '2', '3.14'])).toBe('number')
    })

    it('detects boolean columns (case-insensitive)', () => {
      expect(inferColumnType(['true', 'FALSE', 'True'])).toBe('boolean')
    })

    it('detects ISO date columns', () => {
      expect(inferColumnType(['2024-01-01', '2024-02-01T12:00:00'])).toBe('date')
    })

    it('falls back to "string"', () => {
      expect(inferColumnType(['abc', 'def'])).toBe('string')
      expect(inferColumnType(['1', 'abc'])).toBe('string')
    })
  })

  describe('sanitizeName', () => {
    it('strips unsupported chars and collapses underscores', () => {
      expect(sanitizeName('Hello World!')).toBe('Hello_World')
      expect(sanitizeName('  foo-bar  ')).toBe('foo_bar')
    })

    it('prefixes names that start with a digit', () => {
      expect(sanitizeName('123abc')).toBe('col_123abc')
    })

    it('fills in an empty name with the prefix', () => {
      expect(sanitizeName('$$$')).toBe('col_')
    })
  })

  describe('inferSchemaFromCsv', () => {
    it('produces sanitized column names and inferred types', () => {
      const { columns, headerToColumn } = inferSchemaFromCsv(
        ['First Name', 'Age', 'Active'],
        [
          { 'First Name': 'Alice', Age: '30', Active: 'true' },
          { 'First Name': 'Bob', Age: '40', Active: 'false' },
        ]
      )
      expect(columns).toEqual([
        { name: 'First_Name', type: 'string' },
        { name: 'Age', type: 'number' },
        { name: 'Active', type: 'boolean' },
      ])
      expect(headerToColumn.get('First Name')).toBe('First_Name')
      expect(headerToColumn.get('Age')).toBe('Age')
    })

    it('disambiguates duplicate sanitized headers', () => {
      const { columns } = inferSchemaFromCsv(
        ['a b', 'a-b', 'a.b'],
        [{ 'a b': '1', 'a-b': '2', 'a.b': '3' }]
      )
      expect(columns.map((c) => c.name)).toEqual(['a_b', 'a_b_2', 'a_b_3'])
    })
  })

  describe('coerceValue', () => {
    it('returns null for empty values', () => {
      expect(coerceValue(null, 'string')).toBeNull()
      expect(coerceValue(undefined, 'number')).toBeNull()
      expect(coerceValue('', 'boolean')).toBeNull()
    })

    it('coerces numbers', () => {
      expect(coerceValue('42', 'number')).toBe(42)
      expect(coerceValue('not a number', 'number')).toBeNull()
    })

    it('coerces booleans strictly', () => {
      expect(coerceValue('true', 'boolean')).toBe(true)
      expect(coerceValue('FALSE', 'boolean')).toBe(false)
      expect(coerceValue('yes', 'boolean')).toBeNull()
    })

    it('coerces dates to ISO strings and falls back to the original string', () => {
      expect(coerceValue('2024-01-01', 'date')).toBe(new Date('2024-01-01').toISOString())
      expect(coerceValue('not-a-date', 'date')).toBe('not-a-date')
    })
  })

  describe('buildAutoMapping', () => {
    const schema: TableSchema = {
      columns: [
        { name: 'First_Name', type: 'string' },
        { name: 'age', type: 'number' },
      ],
    }

    it('maps by exact sanitized name', () => {
      const mapping = buildAutoMapping(['First_Name', 'age'], schema)
      expect(mapping).toEqual({ First_Name: 'First_Name', age: 'age' })
    })

    it('falls back to a case/punctuation-insensitive match', () => {
      const mapping = buildAutoMapping(['first name', 'AGE'], schema)
      expect(mapping).toEqual({ 'first name': 'First_Name', AGE: 'age' })
    })

    it('returns null for headers without a match', () => {
      const mapping = buildAutoMapping(['unmatched'], schema)
      expect(mapping).toEqual({ unmatched: null })
    })
  })

  describe('validateMapping', () => {
    const schema: TableSchema = {
      columns: [
        { name: 'name', type: 'string', required: true },
        { name: 'age', type: 'number' },
      ],
    }

    it('accepts a valid mapping and lists skipped/unmapped', () => {
      const result = validateMapping({
        csvHeaders: ['name', 'age', 'extra'],
        mapping: { name: 'name', age: 'age', extra: null },
        tableSchema: schema,
      })
      expect(result.mappedHeaders).toEqual(['name', 'age'])
      expect(result.skippedHeaders).toEqual(['extra'])
      expect(result.unmappedColumns).toEqual([])
      expect(result.effectiveMap.get('name')).toBe('name')
      expect(result.effectiveMap.has('extra')).toBe(false)
    })

    it('throws when a required column is missing', () => {
      expect(() =>
        validateMapping({
          csvHeaders: ['age'],
          mapping: { age: 'age' },
          tableSchema: schema,
        })
      ).toThrow(CsvImportValidationError)
    })

    it('throws when a mapping targets a non-existent column', () => {
      expect(() =>
        validateMapping({
          csvHeaders: ['name'],
          mapping: { name: 'nonexistent' },
          tableSchema: schema,
        })
      ).toThrow(/do not exist on the table/)
    })

    it('throws when multiple headers map to the same column', () => {
      expect(() =>
        validateMapping({
          csvHeaders: ['a', 'b'],
          mapping: { a: 'name', b: 'name' },
          tableSchema: schema,
        })
      ).toThrow(/same column/)
    })

    it('throws when mapping references an unknown CSV header', () => {
      expect(() =>
        validateMapping({
          csvHeaders: ['name'],
          mapping: { name: 'name', bogus: 'age' },
          tableSchema: schema,
        })
      ).toThrow(/unknown CSV headers/)
    })

    it('throws when a mapping value is neither a string nor null', () => {
      expect(() =>
        validateMapping({
          csvHeaders: ['name'],
          mapping: { name: 42 as unknown as string },
          tableSchema: schema,
        })
      ).toThrow(/Mapping values must be/)
    })
  })

  describe('coerceRowsForTable', () => {
    const schema: TableSchema = {
      columns: [
        { name: 'name', type: 'string' },
        { name: 'age', type: 'number' },
        { name: 'active', type: 'boolean' },
      ],
    }

    it('applies the table column type using the effective mapping', () => {
      const rows = coerceRowsForTable(
        [
          { Name: 'Alice', Age: '30', Active: 'true' },
          { Name: 'Bob', Age: 'oops', Active: 'false' },
        ],
        schema,
        new Map([
          ['Name', 'name'],
          ['Age', 'age'],
          ['Active', 'active'],
        ])
      )

      expect(rows).toEqual([
        { name: 'Alice', age: 30, active: true },
        { name: 'Bob', age: null, active: false },
      ])
    })

    it('drops CSV headers absent from the mapping', () => {
      const rows = coerceRowsForTable(
        [{ name: 'Alice', extra: 'keep me out' }],
        schema,
        new Map([['name', 'name']])
      )
      expect(rows).toEqual([{ name: 'Alice' }])
    })
  })
})
