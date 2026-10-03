import { describe, expect, it } from 'vitest'
import {
  collectInputFormatFiles,
  extractInputFieldsFromBlocks,
  isFileFieldType,
  normalizeInputFormatValue,
  parseInputFormatFiles,
} from '@/lib/workflows/input-format'

describe('extractInputFieldsFromBlocks', () => {
  it.concurrent('extracts fields from start_trigger block', () => {
    const blocks = {
      'trigger-1': {
        type: 'start_trigger',
        subBlocks: {
          inputFormat: {
            value: [
              { name: 'query', type: 'string' },
              { name: 'count', type: 'number' },
            ],
          },
        },
      },
    }
    expect(extractInputFieldsFromBlocks(blocks)).toEqual([
      { name: 'query', type: 'string' },
      { name: 'count', type: 'number' },
    ])
  })

  it.concurrent('preserves a stable field id when present, omits it when absent', () => {
    const blocks = {
      'trigger-1': {
        type: 'start_trigger',
        subBlocks: {
          inputFormat: {
            value: [
              { id: 'fld-1', name: 'query', type: 'string' },
              { name: 'count', type: 'number' },
            ],
          },
        },
      },
    }
    expect(extractInputFieldsFromBlocks(blocks)).toEqual([
      { id: 'fld-1', name: 'query', type: 'string' },
      { name: 'count', type: 'number' },
    ])
  })

  it.concurrent('defaults type to string when not provided', () => {
    const blocks = {
      'trigger-1': {
        type: 'start_trigger',
        subBlocks: {
          inputFormat: {
            value: [{ name: 'field1' }, { name: 'field2', type: 'number' }],
          },
        },
      },
    }
    expect(extractInputFieldsFromBlocks(blocks)).toEqual([
      { name: 'field1', type: 'string' },
      { name: 'field2', type: 'number' },
    ])
  })

  it.concurrent('filters out fields with empty names', () => {
    const blocks = {
      'trigger-1': {
        type: 'start_trigger',
        subBlocks: {
          inputFormat: {
            value: [
              { name: '', type: 'string' },
              { name: 'valid', type: 'string' },
              { name: '  ' },
            ],
          },
        },
      },
    }
    expect(extractInputFieldsFromBlocks(blocks)).toEqual([{ name: 'valid', type: 'string' }])
  })

  it.concurrent('extracts from legacy config.params.inputFormat location', () => {
    const blocks = {
      'trigger-1': {
        type: 'start_trigger',
        config: {
          params: {
            inputFormat: [{ name: 'legacy_field', type: 'string' }],
          },
        },
      },
    }
    expect(extractInputFieldsFromBlocks(blocks)).toEqual([{ name: 'legacy_field', type: 'string' }])
  })

  it.concurrent('prefers subBlocks over config.params', () => {
    const blocks = {
      'trigger-1': {
        type: 'start_trigger',
        subBlocks: {
          inputFormat: {
            value: [{ name: 'primary', type: 'string' }],
          },
        },
        config: {
          params: {
            inputFormat: [{ name: 'legacy', type: 'string' }],
          },
        },
      },
    }
    expect(extractInputFieldsFromBlocks(blocks)).toEqual([{ name: 'primary', type: 'string' }])
  })
})

describe('normalizeInputFormatValue', () => {
  it.concurrent('filters fields with valid names', () => {
    const input = [
      { name: 'valid1', type: 'string' },
      { name: 'valid2', type: 'number' },
    ]
    expect(normalizeInputFormatValue(input)).toEqual(input)
  })
})

describe('isFileFieldType', () => {
  it.concurrent('does not match legacy variants or other types (no behavior change)', () => {
    expect(isFileFieldType('files')).toBe(true)
    expect(isFileFieldType('file')).toBe(false)
    expect(isFileFieldType('image')).toBe(false)
    expect(isFileFieldType('string')).toBe(false)
    expect(isFileFieldType('array')).toBe(false)
    expect(isFileFieldType(undefined)).toBe(false)
    expect(isFileFieldType(null)).toBe(false)
  })
})

describe('parseInputFormatFiles', () => {
  const file = {
    id: 'f1',
    name: 'doc.pdf',
    url: '/api/files/serve/workspace%2Fws-1%2F1700000000000-doc.pdf?context=workspace',
    key: 'key',
    size: 10,
    type: 'application/pdf',
  }

  it.concurrent('parses a JSON string of run-ready files', () => {
    expect(parseInputFormatFiles(JSON.stringify([file]))).toEqual([file])
  })

  it.concurrent('returns empty for blank, invalid, or non-array values', () => {
    expect(parseInputFormatFiles('')).toEqual([])
    expect(parseInputFormatFiles('   ')).toEqual([])
    expect(parseInputFormatFiles(undefined)).toEqual([])
    expect(parseInputFormatFiles('not json')).toEqual([])
    expect(parseInputFormatFiles('{"name":"x"}')).toEqual([])
  })

  it.concurrent('drops legacy entries missing id/url (base64 placeholder, raw text)', () => {
    expect(
      parseInputFormatFiles(
        JSON.stringify([{ data: '<base64>', type: 'file', name: 'document.pdf', mime: 'x' }])
      )
    ).toEqual([])
    expect(parseInputFormatFiles(JSON.stringify([{ name: 'doc.pdf', path: '/legacy' }]))).toEqual(
      []
    )
  })

  it.concurrent('rejects partial files missing the run-ready size/type', () => {
    expect(parseInputFormatFiles(JSON.stringify([{ id: 'x', name: 'a.pdf', url: '/u' }]))).toEqual(
      []
    )
    expect(
      parseInputFormatFiles(
        JSON.stringify([{ id: 'x', name: 'a.pdf', url: '/u', size: Number.NaN, type: 'x' }])
      )
    ).toEqual([])
  })

  it.concurrent('rejects files with no key and a non-internal url (key unrecoverable)', () => {
    const { key, ...noKey } = file
    const external = { ...noKey, url: 'https://example.com/x.pdf' }
    expect(parseInputFormatFiles(JSON.stringify([external]))).toEqual([])
    expect(parseInputFormatFiles(JSON.stringify([{ ...external, key: '' }]))).toEqual([])
  })

  it.concurrent('accepts a key-less file when the url is an internal serve url', () => {
    const { key, ...noKey } = file
    expect(parseInputFormatFiles(JSON.stringify([noKey]))).toEqual([noKey])
  })

  it.concurrent('rejects a key-less file whose internal url yields no key', () => {
    const { key, ...noKey } = file
    expect(parseInputFormatFiles(JSON.stringify([{ ...noKey, url: '/api/files/serve/' }]))).toEqual(
      []
    )
  })

  it.concurrent('rejects empty-string id/name/url/type (executor treats them as falsy)', () => {
    expect(parseInputFormatFiles(JSON.stringify([{ ...file, id: '' }]))).toEqual([])
    expect(parseInputFormatFiles(JSON.stringify([{ ...file, name: '' }]))).toEqual([])
    expect(parseInputFormatFiles(JSON.stringify([{ ...file, url: '' }]))).toEqual([])
    expect(parseInputFormatFiles(JSON.stringify([{ ...file, type: '' }]))).toEqual([])
  })
})

describe('collectInputFormatFiles', () => {
  const file = {
    id: 'f1',
    name: 'doc.pdf',
    url: '/api/files/serve/workspace%2Fws-1%2F1700000000000-doc.pdf?context=workspace',
    key: 'key',
    size: 10,
    type: 'application/pdf',
  }

  it.concurrent('collects canonical and legacy file fields, ignoring other types', () => {
    const value = [
      { name: 'query', type: 'string', value: 'hi' },
      { name: 'a', type: 'file[]', value: JSON.stringify([file]) },
      { name: 'b', type: 'file[]', value: JSON.stringify([{ ...file, id: 'f2' }]) },
      { name: 'legacy', type: 'files', value: JSON.stringify([{ ...file, id: 'legacy' }]) },
    ]
    expect(collectInputFormatFiles(value).map((f) => f.id)).toEqual(['f1', 'f2', 'legacy'])
  })

  it.concurrent('ignores legacy/unparseable file values', () => {
    const value = [
      { name: 'a', type: 'file[]', value: 'C:/Users/x/budget.xlsx' },
      { name: 'b', type: 'file[]', value: '[{"data":"<base64>"}]' },
      { name: 'c', type: 'file[]', value: '' },
    ]
    expect(collectInputFormatFiles(value)).toEqual([])
  })
})
