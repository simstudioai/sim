/**
 * @vitest-environment node
 */
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { uniqueColumnName } from '@/lib/table/column-naming'
import {
  buildAutoMapping,
  CsvImportValidationError,
  coerceRowsForTable,
  coerceValue,
  createCsvParser,
  csvParseOptions,
  inferColumnType,
  inferSchemaFromCsv,
  parseCsvBuffer,
  sanitizeColumnName,
  sanitizeName,
  validateMapping,
} from '@/lib/table/import'
import type { TableSchema } from '@/lib/table/types'

describe('import', () => {
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

  describe('sanitizeColumnName', () => {
    it('preserves spaces, digits, punctuation, and unicode verbatim', () => {
      expect(sanitizeColumnName('First Name')).toBe('First Name')
      expect(sanitizeColumnName('2024 Revenue ($)')).toBe('2024 Revenue ($)')
      expect(sanitizeColumnName('caf\u00e9')).toBe('caf\u00e9')
    })

    it('collapses control chars and whitespace runs, strips invisible chars, and trims', () => {
      expect(sanitizeColumnName('a\u0000b')).toBe('a b')
      expect(sanitizeColumnName('  a   b  ')).toBe('a b')
      expect(sanitizeColumnName('zero\u200bwidth')).toBe('zerowidth')
      expect(sanitizeColumnName('$$or')).toBe('or')
    })

    it('truncates to the max column-name length', () => {
      expect(sanitizeColumnName('x'.repeat(80))).toHaveLength(50)
    })

    it('falls back for empty or invisible-only input', () => {
      expect(sanitizeColumnName('')).toBe('column')
      expect(sanitizeColumnName('\u0001\u200b')).toBe('column')
      expect(sanitizeColumnName('', 'field')).toBe('field')
    })
  })

  describe('uniqueColumnName', () => {
    it('returns the base when free, suffixes case-insensitively when taken, and claims the result', () => {
      const taken = new Set(['first name'])
      expect(uniqueColumnName('Email', taken)).toBe('Email')
      expect(uniqueColumnName('First Name', taken)).toBe('First Name_2')
      expect(taken).toEqual(new Set(['first name', 'email', 'first name_2']))
    })

    it('keeps the suffixed result within the max length', () => {
      const base = 'x'.repeat(50)
      const taken = new Set([base])
      const result = uniqueColumnName(base, taken)
      expect(result).toBe(`${'x'.repeat(48)}_2`)
      expect(result.length).toBeLessThanOrEqual(50)
    })
  })

  describe('inferSchemaFromCsv', () => {
    it('preserves raw headers as column names and infers types', () => {
      const { columns, headerToColumn } = inferSchemaFromCsv(
        ['First Name', 'Age', 'Active'],
        [
          { 'First Name': 'Alice', Age: '30', Active: 'true' },
          { 'First Name': 'Bob', Age: '40', Active: 'false' },
        ]
      )
      expect(columns).toEqual([
        { name: 'First Name', type: 'string' },
        { name: 'Age', type: 'number' },
        { name: 'Active', type: 'boolean' },
      ])
      expect(headerToColumn.get('First Name')).toBe('First Name')
      expect(headerToColumn.get('Age')).toBe('Age')
    })

    it('disambiguates headers that collide case-insensitively', () => {
      const { columns } = inferSchemaFromCsv(
        ['a b', 'A B', 'a b '],
        [{ 'a b': '1', 'A B': '2', 'a b ': '3' }]
      )
      expect(columns.map((c) => c.name)).toEqual(['a b', 'A B_2', 'a b_3'])
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

    it('keeps date-only values as calendar dates, preserves datetime wall times with their offset, and falls back to the original string', () => {
      expect(coerceValue('2024-01-01', 'date')).toBe('2024-01-01')
      expect(coerceValue('2024-01-01T12:30:00-07:00', 'date')).toBe('2024-01-01T12:30:00-07:00')
      expect(coerceValue('2024-01-01 12:30', 'date', { timezone: 'America/New_York' })).toBe(
        '2024-01-01T12:30:00-05:00'
      )
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

    it('exact-matches raw display names, trimming padded headers', () => {
      const rawSchema: TableSchema = { columns: [{ name: 'First Name', type: 'string' }] }
      expect(buildAutoMapping(['First Name'], rawSchema)).toEqual({ 'First Name': 'First Name' })
      expect(buildAutoMapping([' First Name '], rawSchema)).toEqual({
        ' First Name ': 'First Name',
      })
    })

    it('never fuzzy-matches columns whose names collapse to an empty loose key', () => {
      const nonLatin: TableSchema = { columns: [{ name: '\u540d\u524d', type: 'string' }] }
      expect(buildAutoMapping(['!!!'], nonLatin)).toEqual({ '!!!': null })
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

  describe('createCsvParser', () => {
    async function parseViaStream(csv: string, delimiter = ',') {
      const parser = createCsvParser(delimiter)
      Readable.from([csv]).pipe(parser)
      const rows: Record<string, unknown>[] = []
      for await (const record of parser as AsyncIterable<Record<string, unknown>>) {
        rows.push(record)
      }
      return rows
    }

    it('streams records keyed by header, matching parseCsvBuffer', async () => {
      const csv = 'name,age\nAlice,30\nBob,40\n'
      const streamed = await parseViaStream(csv)
      const { rows: buffered } = await parseCsvBuffer(csv)
      expect(streamed).toEqual(buffered)
      expect(streamed).toEqual([
        { name: 'Alice', age: '30' },
        { name: 'Bob', age: '40' },
      ])
    })

    it('honors a TSV delimiter', async () => {
      const rows = await parseViaStream('name\tage\nAlice\t30\n', '\t')
      expect(rows).toEqual([{ name: 'Alice', age: '30' }])
    })

    it('strips a leading UTF-8 BOM', async () => {
      const rows = await parseViaStream('﻿name,age\nAlice,30\n')
      expect(Object.keys(rows[0])).toEqual(['name', 'age'])
    })
  })

  describe('csvParseOptions', () => {
    it('sets columns, bom, and the delimiter', () => {
      expect(csvParseOptions('\t')).toMatchObject({ columns: true, bom: true, delimiter: '\t' })
    })
  })
})
