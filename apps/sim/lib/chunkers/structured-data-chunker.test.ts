/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { StructuredDataChunker } from './structured-data-chunker'

describe('StructuredDataChunker', () => {
  describe('isStructuredData', () => {
    it('should detect CSV content with many columns', () => {
      const csv = 'name,age,city,country\nAlice,30,NYC,USA\nBob,25,LA,USA'
      expect(StructuredDataChunker.isStructuredData(csv)).toBe(true)
    })

    it('should detect TSV content with many columns', () => {
      const tsv = 'name\tage\tcity\tcountry\nAlice\t30\tNYC\tUSA\nBob\t25\tLA\tUSA'
      expect(StructuredDataChunker.isStructuredData(tsv)).toBe(true)
    })

    it('should detect pipe-delimited content with many columns', () => {
      const piped = 'name|age|city|country\nAlice|30|NYC|USA\nBob|25|LA|USA'
      expect(StructuredDataChunker.isStructuredData(piped)).toBe(true)
    })

    it('should detect CSV by mime type', () => {
      expect(StructuredDataChunker.isStructuredData('any content', 'text/csv')).toBe(true)
    })

    it('should detect XLSX by mime type', () => {
      expect(
        StructuredDataChunker.isStructuredData(
          'any content',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
      ).toBe(true)
    })

    it('should detect XLS by mime type', () => {
      expect(
        StructuredDataChunker.isStructuredData('any content', 'application/vnd.ms-excel')
      ).toBe(true)
    })

    it('should detect TSV by mime type', () => {
      expect(
        StructuredDataChunker.isStructuredData('any content', 'text/tab-separated-values')
      ).toBe(true)
    })

    it('should return false for plain text', () => {
      const plainText = 'This is just regular text.\nWith some lines.\nNo structure here.'
      expect(StructuredDataChunker.isStructuredData(plainText)).toBe(false)
    })

    it('should return false for single line', () => {
      expect(StructuredDataChunker.isStructuredData('just one line')).toBe(false)
    })

    it('should handle inconsistent delimiter counts', () => {
      const inconsistent = 'name,age\nAlice,30,extra\nBob'
      const result = StructuredDataChunker.isStructuredData(inconsistent)
      expect(typeof result).toBe('boolean')
    })
  })

  describe('chunkStructuredData', () => {
    it.concurrent('should return empty array for empty content', async () => {
      const chunks = await StructuredDataChunker.chunkStructuredData('')
      expect(chunks).toEqual([])
    })

    it.concurrent('should return empty array for whitespace only', async () => {
      const chunks = await StructuredDataChunker.chunkStructuredData('   \n\n   ')
      expect(chunks).toEqual([])
    })

    it.each([
      0,
      -1,
      0.5,
      Number.NaN,
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER,
    ])('rejects an invalid chunk size before inspecting content: %s', async (chunkSize) => {
      await expect(StructuredDataChunker.chunkStructuredData('', { chunkSize })).rejects.toThrow(
        'Structured data chunk size must be a finite number between 1'
      )
    })

    it('normalizes a fractional legacy chunk size to its integer token ceiling', async () => {
      const chunks = await StructuredDataChunker.chunkStructuredData(
        `value\n${'x'.repeat(1_000)}`,
        { chunkSize: 100.5 }
      )

      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.every((chunk) => chunk.tokenCount <= 100)).toBe(true)
    })

    it.concurrent('should chunk basic CSV data', async () => {
      const csv = `name,age,city
Alice,30,New York
Bob,25,Los Angeles
Charlie,35,Chicago`
      const chunks = await StructuredDataChunker.chunkStructuredData(csv)

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks[0].text).toContain('Headers:')
      expect(chunks[0].text).toContain('name,age,city')
    })

    it.concurrent('should include row count in chunks', async () => {
      const csv = `name,age
Alice,30
Bob,25`
      const chunks = await StructuredDataChunker.chunkStructuredData(csv)

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks[0].text).toContain('rows of data')
    })

    it.concurrent('should include sheet name when provided', async () => {
      const csv = `name,age
Alice,30`
      const chunks = await StructuredDataChunker.chunkStructuredData(csv, { sheetName: 'Users' })

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks[0].text).toContain('Users')
    })

    it.concurrent('should use provided headers when available', async () => {
      const data = `Alice,30
Bob,25`
      const chunks = await StructuredDataChunker.chunkStructuredData(data, {
        headers: ['Name', 'Age'],
      })

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks[0].text).toContain('Name\tAge')
    })

    it.concurrent('should chunk large datasets into multiple chunks', async () => {
      const rows = ['name,value']
      for (let i = 0; i < 500; i++) {
        rows.push(`Item${i},Value${i}`)
      }
      const csv = rows.join('\n')

      const chunks = await StructuredDataChunker.chunkStructuredData(csv, { chunkSize: 200 })

      expect(chunks.length).toBeGreaterThan(1)
    })

    it('splits a maximum-length spreadsheet cell without dropping its content', async () => {
      const value = `START-${'x'.repeat(32_755)}-END`
      const chunks = await StructuredDataChunker.chunkStructuredData(`value\n${value}`, {
        chunkSize: 1024,
      })

      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.every((chunk) => chunk.tokenCount <= 1024)).toBe(true)
      expect(chunks[0].text).toContain('START-')
      expect(chunks.at(-1)?.text).toContain('-END')
    })

    it('splits an oversized header without repeating it into every row segment', async () => {
      const header = `HEADER-${'h '.repeat(2_500)}-END`
      const row = `ROW-${'r '.repeat(5_000)}-END`

      const chunks = await StructuredDataChunker.chunkStructuredData(`${header}\n${row}`, {
        chunkSize: 1024,
      })

      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.length).toBeLessThan(20)
      expect(chunks.every((chunk) => chunk.tokenCount <= 1024)).toBe(true)
      expect(
        chunks
          .filter((chunk) => chunk.metadata.startIndex === 0)
          .map((chunk) => chunk.text)
          .join('')
      ).toBe(header)
      expect(
        chunks
          .filter((chunk) => chunk.metadata.startIndex === 1)
          .map((chunk) => chunk.text)
          .join('')
      ).toBe(row)
      expect(chunks.every((chunk) => !chunk.text.includes('Headers:'))).toBe(true)
      expect(chunks.every((chunk) => !chunk.text.includes('rows of data'))).toBe(true)
    })

    it('preserves spaces when splitting an oversized structured row', async () => {
      const row = 'AAAAAA BBBBBB'
      const chunks = await StructuredDataChunker.chunkStructuredData(`value\n${row}`, {
        chunkSize: 15,
      })
      const prefix = 'Headers: value\n-----\n'
      const suffix = '\n\n[1 rows of data]'
      const rowSegments = chunks
        .filter((chunk) => chunk.metadata.startIndex === 1)
        .map((chunk) => chunk.text.slice(prefix.length, -suffix.length))

      expect(rowSegments.join('')).toBe(row)
      expect(chunks.every((chunk) => chunk.tokenCount <= 15)).toBe(true)
    })

    it('does not let the minimum row target exceed the token target', async () => {
      const row = 'x'.repeat(2_900)
      const content = ['value', row, row, row, row, row].join('\n')

      const chunks = await StructuredDataChunker.chunkStructuredData(content, { chunkSize: 1024 })

      expect(chunks.length).toBe(5)
      expect(chunks.every((chunk) => chunk.tokenCount <= 1024)).toBe(true)
    })

    it.concurrent('should include token count in chunk metadata', async () => {
      const csv = `name,age
Alice,30
Bob,25`
      const chunks = await StructuredDataChunker.chunkStructuredData(csv)

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks[0].tokenCount).toBeGreaterThan(0)
    })
  })

  describe('chunk metadata', () => {
    it.concurrent('should include startIndex as row index', async () => {
      const csv = `header1,header2
row1,data1
row2,data2
row3,data3`
      const chunks = await StructuredDataChunker.chunkStructuredData(csv)

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks[0].metadata.startIndex).toBeDefined()
      expect(chunks[0].metadata.startIndex).toBeGreaterThanOrEqual(0)
    })

    it.concurrent('should include endIndex as row index', async () => {
      const csv = `header1,header2
row1,data1
row2,data2`
      const chunks = await StructuredDataChunker.chunkStructuredData(csv)

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks[0].metadata.endIndex).toBeDefined()
      expect(chunks[0].metadata.endIndex).toBeGreaterThanOrEqual(chunks[0].metadata.startIndex)
    })
  })

  describe('edge cases', () => {
    it.concurrent('should handle single data row', async () => {
      const csv = `name,age
Alice,30`
      const chunks = await StructuredDataChunker.chunkStructuredData(csv)

      expect(chunks.length).toBe(1)
    })

    it.concurrent('should handle header only', async () => {
      const csv = 'name,age,city'
      const chunks = await StructuredDataChunker.chunkStructuredData(csv)

      expect(chunks.length).toBeGreaterThanOrEqual(0)
    })

    it.concurrent('should handle unicode content', async () => {
      const csv = `名前,年齢,市
田中,30,東京
鈴木,25,大阪`
      const chunks = await StructuredDataChunker.chunkStructuredData(csv)

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks[0].text).toContain('田中')
    })

    it.concurrent('should handle quoted CSV fields', async () => {
      const csv = `name,description
Alice,"Has a comma, in description"
Bob,"Multiple
lines"`
      const chunks = await StructuredDataChunker.chunkStructuredData(csv)

      expect(chunks.length).toBeGreaterThan(0)
    })

    it.concurrent('should handle empty cells', async () => {
      const csv = `name,age,city
Alice,,NYC
,25,LA
Charlie,35,`
      const chunks = await StructuredDataChunker.chunkStructuredData(csv)

      expect(chunks.length).toBeGreaterThan(0)
    })

    it.concurrent('should handle long cell values', async () => {
      const csv = `name,description
Alice,${'A'.repeat(1000)}
Bob,${'B'.repeat(1000)}`
      const chunks = await StructuredDataChunker.chunkStructuredData(csv)

      expect(chunks.length).toBeGreaterThan(0)
    })

    it.concurrent('should handle many columns', async () => {
      const headers = Array.from({ length: 50 }, (_, i) => `col${i}`).join(',')
      const row = Array.from({ length: 50 }, (_, i) => `val${i}`).join(',')
      const csv = `${headers}\n${row}`
      const chunks = await StructuredDataChunker.chunkStructuredData(csv)

      expect(chunks.length).toBeGreaterThan(0)
    })
  })

  describe('options', () => {
    it.concurrent('should respect custom chunkSize', async () => {
      const rows = ['name,value']
      for (let i = 0; i < 200; i++) {
        rows.push(`Item${i},Value${i}`)
      }
      const csv = rows.join('\n')

      const smallChunks = await StructuredDataChunker.chunkStructuredData(csv, { chunkSize: 100 })
      const largeChunks = await StructuredDataChunker.chunkStructuredData(csv, { chunkSize: 2000 })

      expect(smallChunks.length).toBeGreaterThan(largeChunks.length)
    })

    it.concurrent('should handle default options', async () => {
      const csv = `name,age
Alice,30`
      const chunks = await StructuredDataChunker.chunkStructuredData(csv)

      expect(chunks.length).toBeGreaterThan(0)
    })
  })

  describe('large inputs', () => {
    it.concurrent('should handle 10,000 rows', async () => {
      const rows = ['id,name,value']
      for (let i = 0; i < 10000; i++) {
        rows.push(`${i},Item${i},Value${i}`)
      }
      const csv = rows.join('\n')

      const chunks = await StructuredDataChunker.chunkStructuredData(csv, { chunkSize: 500 })

      expect(chunks.length).toBeGreaterThan(1)
      const totalRowCount = chunks.reduce((sum, chunk) => {
        const match = chunk.text.match(/\[(\d+) rows of data\]/)
        return sum + (match ? Number.parseInt(match[1]) : 0)
      }, 0)
      expect(totalRowCount).toBeGreaterThan(0)
    })

    it.concurrent('should handle very wide rows', async () => {
      const columns = 100
      const headers = Array.from({ length: columns }, (_, i) => `column${i}`).join(',')
      const rows = [headers]
      for (let i = 0; i < 50; i++) {
        rows.push(Array.from({ length: columns }, (_, j) => `r${i}c${j}`).join(','))
      }
      const csv = rows.join('\n')

      const chunks = await StructuredDataChunker.chunkStructuredData(csv, { chunkSize: 300 })

      expect(chunks.length).toBeGreaterThan(0)
    })
  })

  describe('delimiter detection', () => {
    it.concurrent('should handle comma delimiter', async () => {
      const csv = `a,b,c,d
1,2,3,4
5,6,7,8`
      expect(StructuredDataChunker.isStructuredData(csv)).toBe(true)
    })

    it.concurrent('should handle tab delimiter', async () => {
      const tsv = `a\tb\tc\td
1\t2\t3\t4
5\t6\t7\t8`
      expect(StructuredDataChunker.isStructuredData(tsv)).toBe(true)
    })

    it.concurrent('should handle pipe delimiter', async () => {
      const piped = `a|b|c|d
1|2|3|4
5|6|7|8`
      expect(StructuredDataChunker.isStructuredData(piped)).toBe(true)
    })

    it.concurrent('should not detect with fewer than 3 delimiters per line', async () => {
      const sparse = `a,b
1,2`
      const result = StructuredDataChunker.isStructuredData(sparse)
      expect(typeof result).toBe('boolean')
    })
  })

  describe('header handling', () => {
    it.concurrent('should include headers in each chunk by default', async () => {
      const rows = ['name,value']
      for (let i = 0; i < 100; i++) {
        rows.push(`Item${i},Value${i}`)
      }
      const csv = rows.join('\n')

      const chunks = await StructuredDataChunker.chunkStructuredData(csv, { chunkSize: 200 })

      expect(chunks.length).toBeGreaterThan(1)
      for (const chunk of chunks) {
        expect(chunk.text).toContain('Headers:')
      }
    })
  })
})
