/**
 * @vitest-environment node
 */
import { Readable } from 'node:stream'
import { sleep } from '@sim/utils/helpers'
import { describe, expect, it } from 'vitest'
import { sniffCsvDelimiterFromStream } from '@/lib/table/csv-delimiter-stream'
import {
  buildAutoMapping,
  CSV_DELIMITER_SNIFF_BYTES,
  CsvImportValidationError,
  coerceRowsForTable,
  coerceValue,
  createCsvParser,
  csvParseOptions,
  dedupeHeaders,
  detectCsvDelimiter,
  inferColumnType,
  inferSchemaFromCsv,
  parseCsvBuffer,
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
    it('sets bom and the delimiter, with a header-capturing columns callback', () => {
      const options = csvParseOptions('\t')
      expect(options).toMatchObject({ bom: true, delimiter: '\t' })
      expect(typeof options.columns).toBe('function')
    })

    it('invokes onHeaders with the full header row', () => {
      let captured: string[] | null = null
      const options = csvParseOptions(',', (h) => {
        captured = h
      })
      // csv-parse calls the columns function with the parsed header array.
      ;(options.columns as (h: string[]) => string[])(['a', 'b', 'c'])
      expect(captured).toEqual(['a', 'b', 'c'])
    })
  })

  describe('parseCsvBuffer header derivation', () => {
    it('reports every header even when the first data row is ragged (short)', async () => {
      // With relax_column_count a short first row omits trailing keys, so deriving
      // headers from Object.keys(rows[0]) would drop c and d. The header callback fixes this.
      const { headers } = await parseCsvBuffer('a,b,c,d\n1,2\n3,4,5,6\n')
      expect(headers).toEqual(['a', 'b', 'c', 'd'])
    })

    it('feeds the full header set into inferSchemaFromCsv for a ragged file', async () => {
      const { headers, rows } = await parseCsvBuffer('a,b,c\n1\n2,3,4\n')
      const { columns } = inferSchemaFromCsv(headers, rows)
      expect(columns.map((c) => c.name)).toEqual(['a', 'b', 'c'])
    })

    it('collapses duplicate header names to match the parser record keys', async () => {
      // csv-parse keys duplicate columns onto one object key (last value wins); the reported
      // headers must match, so schema inference does not invent a phantom empty column.
      const { headers, rows } = await parseCsvBuffer('a,a,b\n1,2,3\n4,5,6\n')
      expect(headers).toEqual(['a', 'b'])
      expect(Object.keys(rows[0])).toEqual(['a', 'b'])
      const { columns } = inferSchemaFromCsv(headers, rows)
      expect(columns.map((c) => c.name)).toEqual(['a', 'b'])
    })
  })

  describe('dedupeHeaders', () => {
    it('drops later exact duplicates, preserving first-occurrence order', () => {
      expect(dedupeHeaders(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c'])
    })

    it('keeps case-distinct names (matches csv-parse key sensitivity)', () => {
      expect(dedupeHeaders(['Name', 'name'])).toEqual(['Name', 'name'])
    })
  })

  describe('detectCsvDelimiter', () => {
    it('detects a comma-delimited file', async () => {
      expect(await detectCsvDelimiter('a,b,c\n1,2,3\n')).toBe(',')
    })

    it('detects a semicolon-delimited file (European Excel export)', async () => {
      expect(await detectCsvDelimiter('a;b;c\n1;2;3\n')).toBe(';')
    })

    it('detects tab and pipe delimiters', async () => {
      expect(await detectCsvDelimiter('a\tb\tc\n1\t2\t3\n')).toBe('\t')
      expect(await detectCsvDelimiter('a|b|c\n1|2|3\n')).toBe('|')
    })

    it('ignores delimiters that appear only inside quoted fields', async () => {
      // Semicolon-separated, but the values are full of commas and newlines — a raw
      // character-frequency count would wrongly pick the comma. A real parse does not.
      const csv = 'id;body\n1;"hello, world\nsecond line"\n2;"a, b, c"\n'
      expect(await detectCsvDelimiter(csv)).toBe(';')
    })

    it('falls back for a single-column file rather than latching onto in-value characters', async () => {
      expect(await detectCsvDelimiter('text\n"hello, world"\n"a, b"\n')).toBe(',')
      expect(await detectCsvDelimiter('text\n"hello, world"\n', ';')).toBe(';')
    })

    it('prefers the consistent delimiter over one that only widens the header row', async () => {
      // The header splits into more fields on comma, but only semicolon yields a uniform
      // column count across the data rows — consistency must win over raw field count.
      expect(await detectCsvDelimiter('a,b;c,d;e,f\n1;2;3\n4;5;6\n')).toBe(';')
    })

    it('detects the real delimiter when the header itself has quoted commas', async () => {
      const csv = '"last, first";age;city\n"Doe, John";30;NYC\n"Roe, Jane";25;LA\n'
      expect(await detectCsvDelimiter(csv)).toBe(';')
    })

    it('prefers a wider ragged split over a narrow one that only looks uniform', async () => {
      // Semicolon is the real delimiter (2- and 3-column rows) while a pipe appears once per
      // row inside values. Scoring width*consistency keeps the wider semicolon split.
      expect(await detectCsvDelimiter('a|label;b;c\nx|y;1\nz|w;2;3\n')).toBe(';')
    })

    it('falls back to comma order only when the split is genuinely ambiguous', async () => {
      // Both ; and , yield exactly two uniform columns — no content signal distinguishes them,
      // so the global-default candidate order (comma first) decides and either reading is valid.
      expect(await detectCsvDelimiter('name;value,unit\na;1,kg\nb;2,kg\n')).toBe(',')
    })

    it('drops a partial trailing line so a mid-record byte cut cannot skew detection', async () => {
      // Simulates a fixed byte-window slice that ends mid-record; the last (partial) line
      // is ignored, so the complete rows above still drive the result.
      expect(await detectCsvDelimiter('a;b;c\n1;2;3\n4;5;')).toBe(';')
    })

    it('keeps the final row of a complete file that has no trailing newline', async () => {
      // Without complete:true the trim would drop the only distinguishing data row, leaving the
      // header alone and letting comma (which merely widens the header) win over semicolon.
      const csv = 'a,b;c,d;e,f\n1;2;3'
      expect(await detectCsvDelimiter(csv, ',', { complete: true })).toBe(';')
      // A truncated prefix (complete:false, the default) still drops the partial tail.
      expect(await detectCsvDelimiter(csv)).toBe(',')
    })

    it('returns the fallback for empty input', async () => {
      expect(await detectCsvDelimiter('', ';')).toBe(';')
    })
  })

  describe('sniffCsvDelimiterFromStream', () => {
    async function collect(stream: Readable): Promise<Buffer> {
      const chunks: Buffer[] = []
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array))
      }
      return Buffer.concat(chunks)
    }

    it('detects the delimiter and replays the full file byte-for-byte', async () => {
      const rows = ['id;a;b;c']
      for (let i = 0; i < 5000; i++) rows.push(`${i};"val, with comma";x;y`)
      const full = Buffer.from(`${rows.join('\n')}\n`)
      const { delimiter, stream } = await sniffCsvDelimiterFromStream(Readable.from([full]))
      expect(delimiter).toBe(';')
      expect((await collect(stream)).equals(full)).toBe(true)
    })

    it('handles a file smaller than the sniff window (exhausted during sniff)', async () => {
      const full = Buffer.from('a;b;c\n1;2;3\n')
      const { delimiter, stream } = await sniffCsvDelimiterFromStream(Readable.from([full]))
      expect(delimiter).toBe(';')
      expect((await collect(stream)).equals(full)).toBe(true)
    })

    it('treats a file exactly the sniff-window size as complete (observes EOF at the boundary)', async () => {
      // Header widens under comma; a single giant data row pads the file to exactly the window
      // with no trailing newline. If the loop stopped at the boundary without seeing EOF, the row
      // would be dropped and comma would win — so this passing proves the boundary EOF is observed.
      const header = 'a,b;c,d;e,f\n'
      const suffix = ';3'
      const pad = 'x'.repeat(
        CSV_DELIMITER_SNIFF_BYTES - header.length - '1;'.length - suffix.length
      )
      const full = Buffer.from(`${header}1;${pad}${suffix}`)
      expect(full.length).toBe(CSV_DELIMITER_SNIFF_BYTES)
      const { delimiter } = await sniffCsvDelimiterFromStream(Readable.from([full]))
      expect(delimiter).toBe(';')
    })

    it('counts the final row of a fully-buffered file with no trailing newline', async () => {
      // The whole file fits the sniff window (exhausted), so complete:true flows through and the
      // last row is scored — semicolon must win despite comma widening the header row.
      const full = Buffer.from('a,b;c,d;e,f\n1;2;3')
      const { delimiter, stream } = await sniffCsvDelimiterFromStream(Readable.from([full]))
      expect(delimiter).toBe(';')
      expect((await collect(stream)).equals(full)).toBe(true)
    })

    it('detects and replays exactly when a single chunk far exceeds the sniff window', async () => {
      // One >1 MiB chunk arrives before the size check — detection must still cap its copy
      // and the replay must emit the original bytes unchanged.
      const rows = ['a;b;c']
      for (let i = 0; i < 40000; i++) rows.push(`${i};${'x'.repeat(20)};y`)
      const full = Buffer.from(`${rows.join('\n')}\n`)
      expect(full.length).toBeGreaterThan(1024 * 1024)
      const { delimiter, stream } = await sniffCsvDelimiterFromStream(Readable.from([full]))
      expect(delimiter).toBe(';')
      expect((await collect(stream)).equals(full)).toBe(true)
    })

    it('reassembles data split across many small chunks', async () => {
      const parts = ['na', 'me,ag', 'e\nfo', 'o,1\nba', 'r,2\n'].map((s) => Buffer.from(s))
      const { delimiter, stream } = await sniffCsvDelimiterFromStream(Readable.from(parts))
      expect(delimiter).toBe(',')
      expect((await collect(stream)).equals(Buffer.concat(parts))).toBe(true)
    })

    it('destroys the source when the replay stream is destroyed early', async () => {
      let destroyed = false
      const pad = 'z'.repeat(290)
      async function* infinite() {
        let i = 0
        while (true) yield Buffer.from(`r${i++};x;${pad}\n`)
      }
      const source = Readable.from(infinite())
      source.on('close', () => {
        destroyed = true
      })
      const { stream } = await sniffCsvDelimiterFromStream(source)
      stream.destroy()
      await sleep(20)
      expect(destroyed).toBe(true)
    })

    it('surfaces a source error that occurs during replay', async () => {
      async function* failing() {
        yield Buffer.from(`a;b;c\n${'1;2;3\n'.repeat(20000)}`)
        throw new Error('storage read failed')
      }
      const { stream } = await sniffCsvDelimiterFromStream(Readable.from(failing()))
      await expect(collect(stream)).rejects.toThrow(/storage read failed/)
    })

    it('returns the fallback for an empty stream', async () => {
      const { delimiter, stream } = await sniffCsvDelimiterFromStream(Readable.from([]), ';')
      expect(delimiter).toBe(';')
      expect((await collect(stream)).length).toBe(0)
    })
  })
})
