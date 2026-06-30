import { describe, expect, it } from 'vitest'
import {
  collectInputFormatFiles,
  createDefaultInputFormatField,
  extractInputFieldsFromBlocks,
  isFileFieldType,
  normalizeInputFormatValue,
  parseInputFormatFiles,
} from '@/lib/workflows/input-format'

describe('extractInputFieldsFromBlocks', () => {
  it.concurrent('returns empty array for null blocks', () => {
    expect(extractInputFieldsFromBlocks(null)).toEqual([])
  })

  it.concurrent('returns empty array for undefined blocks', () => {
    expect(extractInputFieldsFromBlocks(undefined)).toEqual([])
  })

  it.concurrent('returns empty array when no trigger block exists', () => {
    const blocks = {
      'block-1': { type: 'agent', subBlocks: {} },
      'block-2': { type: 'function', subBlocks: {} },
    }
    expect(extractInputFieldsFromBlocks(blocks)).toEqual([])
  })

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

  it.concurrent('extracts fields from input_trigger block', () => {
    const blocks = {
      'trigger-1': {
        type: 'input_trigger',
        subBlocks: {
          inputFormat: {
            value: [{ name: 'message', type: 'string' }],
          },
        },
      },
    }
    expect(extractInputFieldsFromBlocks(blocks)).toEqual([{ name: 'message', type: 'string' }])
  })

  it.concurrent('extracts fields from starter block', () => {
    const blocks = {
      'trigger-1': {
        type: 'starter',
        subBlocks: {
          inputFormat: {
            value: [{ name: 'input', type: 'string' }],
          },
        },
      },
    }
    expect(extractInputFieldsFromBlocks(blocks)).toEqual([{ name: 'input', type: 'string' }])
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

  it.concurrent('filters out non-object fields', () => {
    const blocks = {
      'trigger-1': {
        type: 'start_trigger',
        subBlocks: {
          inputFormat: {
            value: [null, undefined, 'string', 123, { name: 'valid', type: 'string' }],
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

  it.concurrent('returns empty array when inputFormat is not an array', () => {
    const blocks = {
      'trigger-1': {
        type: 'start_trigger',
        subBlocks: {
          inputFormat: {
            value: 'not-an-array',
          },
        },
      },
    }
    expect(extractInputFieldsFromBlocks(blocks)).toEqual([])
  })
})

describe('normalizeInputFormatValue', () => {
  it.concurrent('returns empty array for null', () => {
    expect(normalizeInputFormatValue(null)).toEqual([])
  })

  it.concurrent('returns empty array for undefined', () => {
    expect(normalizeInputFormatValue(undefined)).toEqual([])
  })

  it.concurrent('returns empty array for empty array', () => {
    expect(normalizeInputFormatValue([])).toEqual([])
  })

  it.concurrent('returns empty array for non-array values', () => {
    expect(normalizeInputFormatValue('string')).toEqual([])
    expect(normalizeInputFormatValue(123)).toEqual([])
    expect(normalizeInputFormatValue({ name: 'test' })).toEqual([])
  })

  it.concurrent('filters fields with valid names', () => {
    const input = [
      { name: 'valid1', type: 'string' },
      { name: 'valid2', type: 'number' },
    ]
    expect(normalizeInputFormatValue(input)).toEqual(input)
  })

  it.concurrent('filters out fields without names', () => {
    const input = [{ type: 'string' }, { name: 'valid', type: 'string' }, { value: 'test' }]
    expect(normalizeInputFormatValue(input)).toEqual([{ name: 'valid', type: 'string' }])
  })

  it.concurrent('filters out fields with empty names', () => {
    const input = [
      { name: '', type: 'string' },
      { name: '   ', type: 'string' },
      { name: 'valid', type: 'string' },
    ]
    expect(normalizeInputFormatValue(input)).toEqual([{ name: 'valid', type: 'string' }])
  })

  it.concurrent('filters out null and undefined fields', () => {
    const input = [null, undefined, { name: 'valid', type: 'string' }]
    expect(normalizeInputFormatValue(input)).toEqual([{ name: 'valid', type: 'string' }])
  })

  it.concurrent('preserves all properties of valid fields', () => {
    const input = [
      {
        name: 'field1',
        type: 'string',
        label: 'Field 1',
        description: 'A test field',
        placeholder: 'Enter value',
        required: true,
        value: 'default',
      },
    ]
    expect(normalizeInputFormatValue(input)).toEqual(input)
  })
})

describe('isFileFieldType', () => {
  it.concurrent('matches the canonical file[] type', () => {
    expect(isFileFieldType('file[]')).toBe(true)
  })

  it.concurrent('does not match legacy variants or other types (no behavior change)', () => {
    expect(isFileFieldType('files')).toBe(false)
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
    url: '/api/files/serve/key',
    key: 'key',
    size: 10,
    type: 'application/pdf',
  }

  it.concurrent('parses a JSON string of run-ready files', () => {
    expect(parseInputFormatFiles(JSON.stringify([file]))).toEqual([file])
  })

  it.concurrent('accepts an already-materialized array', () => {
    expect(parseInputFormatFiles([file])).toEqual([file])
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

  it.concurrent('keeps only the valid files in a mixed array', () => {
    expect(parseInputFormatFiles(JSON.stringify([file, { name: 'bad' }]))).toEqual([file])
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

  it.concurrent('rejects files without a usable key', () => {
    const { key, ...noKey } = file
    expect(parseInputFormatFiles(JSON.stringify([noKey]))).toEqual([])
    expect(parseInputFormatFiles(JSON.stringify([{ ...file, key: '' }]))).toEqual([])
  })
})

describe('collectInputFormatFiles', () => {
  const file = {
    id: 'f1',
    name: 'doc.pdf',
    url: '/api/files/serve/key',
    key: 'key',
    size: 10,
    type: 'application/pdf',
  }

  it.concurrent('returns empty for non-array values', () => {
    expect(collectInputFormatFiles(null)).toEqual([])
    expect(collectInputFormatFiles('nope')).toEqual([])
  })

  it.concurrent('collects files only from file[] fields, ignoring other types', () => {
    const value = [
      { name: 'query', type: 'string', value: 'hi' },
      { name: 'a', type: 'file[]', value: JSON.stringify([file]) },
      { name: 'b', type: 'file[]', value: JSON.stringify([{ ...file, id: 'f2' }]) },
      { name: 'legacy', type: 'files', value: JSON.stringify([{ ...file, id: 'ignored' }]) },
    ]
    expect(collectInputFormatFiles(value).map((f) => f.id)).toEqual(['f1', 'f2'])
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

describe('createDefaultInputFormatField', () => {
  it.concurrent('creates an empty field with the canonical default shape', () => {
    const field = createDefaultInputFormatField()
    expect(field).toEqual({
      id: expect.any(String),
      name: '',
      type: 'string',
      value: '',
      collapsed: false,
    })
    expect(field.id.length).toBeGreaterThan(0)
  })

  it.concurrent('omits description so it is not persisted by default', () => {
    expect('description' in createDefaultInputFormatField()).toBe(false)
  })

  it.concurrent('returns a fresh id and a new object on each call', () => {
    const first = createDefaultInputFormatField()
    const second = createDefaultInputFormatField()
    expect(first.id).not.toBe(second.id)
    expect(first).not.toBe(second)
  })
})
