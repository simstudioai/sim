/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  extractTabularData,
  serializeOutputForFile,
  unwrapFunctionExecuteOutput,
} from '@/lib/copilot/request/tools/files'

describe('unwrapFunctionExecuteOutput', () => {
  it('unwraps the function_execute envelope { result, stdout }', () => {
    expect(unwrapFunctionExecuteOutput({ result: 'name,age\nAlice,30', stdout: '' })).toBe(
      'name,age\nAlice,30'
    )
  })

  it('passes through objects that do not have both result + stdout', () => {
    const output = { data: { rows: [], totalCount: 0 } }
    expect(unwrapFunctionExecuteOutput(output)).toBe(output)
  })

  it('passes through strings and arrays untouched', () => {
    expect(unwrapFunctionExecuteOutput('hello')).toBe('hello')
    const arr: unknown[] = [{ a: 1 }]
    expect(unwrapFunctionExecuteOutput(arr)).toBe(arr)
  })
})

describe('serializeOutputForFile (csv)', () => {
  it('returns raw CSV text when function_execute result is already a CSV string', () => {
    const output = {
      result: 'name,age\nAlice,30\nBob,40',
      stdout: '(2 rows)',
    }
    expect(serializeOutputForFile(output, 'csv')).toBe('name,age\nAlice,30\nBob,40')
  })

  it('converts a result array of objects into CSV', () => {
    const output = {
      result: [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 40 },
      ],
      stdout: '',
    }
    expect(serializeOutputForFile(output, 'csv')).toBe('name,age\nAlice,30\nBob,40')
  })

  it('returns the raw string when the non-envelope output is already a CSV string', () => {
    expect(serializeOutputForFile('a,b\n1,2', 'csv')).toBe('a,b\n1,2')
  })

  it('falls back to JSON.stringify when the payload is not tabular and not a string', () => {
    const output = { result: { foo: 'bar' }, stdout: '' }
    expect(serializeOutputForFile(output, 'csv')).toBe('{\n  "foo": "bar"\n}')
  })
})

describe('serializeOutputForFile (json / txt / md)', () => {
  it('unwraps the envelope for json format so the file contains only result', () => {
    const output = { result: { hello: 'world' }, stdout: 'log' }
    expect(serializeOutputForFile(output, 'json')).toBe('{\n  "hello": "world"\n}')
  })

  it('returns the string payload as-is for txt/md/html formats', () => {
    const output = { result: '# Report\n\nHello', stdout: '' }
    expect(serializeOutputForFile(output, 'md')).toBe('# Report\n\nHello')
    expect(serializeOutputForFile(output, 'txt')).toBe('# Report\n\nHello')
    expect(serializeOutputForFile(output, 'html')).toBe('# Report\n\nHello')
  })
})

describe('extractTabularData', () => {
  it('extracts rows directly from an array input', () => {
    expect(extractTabularData([{ a: 1 }, { a: 2 }])).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('does NOT unwrap function_execute envelopes on its own (callers must pre-unwrap)', () => {
    // Caller is responsible for unwrapping { result, stdout } envelopes first.
    // Keeping that concern out of this function prevents a double unwrap when
    // the user's payload itself happens to have matching keys.
    expect(extractTabularData({ result: [{ a: 1 }], stdout: '' })).toBeNull()
  })

  it('extracts rows from the user_table query_rows shape', () => {
    const rows = extractTabularData({
      data: {
        rows: [
          { id: 'row_1', data: { name: 'Alice' } },
          { id: 'row_2', data: { name: 'Bob' } },
        ],
        totalCount: 2,
      },
    })
    expect(rows).toEqual([{ name: 'Alice' }, { name: 'Bob' }])
  })

  it('returns null for non-tabular inputs', () => {
    expect(extractTabularData('plain string')).toBeNull()
    expect(extractTabularData(null)).toBeNull()
    expect(extractTabularData({ foo: 'bar' })).toBeNull()
  })
})
