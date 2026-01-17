import { describe, expect, it } from 'vitest'
import {
  extractInputFieldsFromBlocks,
  normalizeInputFormatValue,
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
