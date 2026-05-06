import { describe, expect, it } from 'vitest'
import {
  isPlainRecord,
  normalizeRecord,
  normalizeRecordMap,
  normalizeStringRecord,
  normalizeWorkflowVariables,
} from '@/lib/core/utils/records'

describe('record normalization utilities', () => {
  it('identifies plain records without accepting arrays or null', () => {
    expect(isPlainRecord({})).toBe(true)
    expect(isPlainRecord(Object.create(null))).toBe(true)
    expect(isPlainRecord([])).toBe(false)
    expect(isPlainRecord(null)).toBe(false)
  })

  it('normalizes unknown values to object records', () => {
    expect(normalizeRecord({ value: 1 })).toEqual({ value: 1 })
    expect(normalizeRecord([])).toEqual({})
    expect(normalizeRecord('not-a-record')).toEqual({})
  })

  it('normalizes string records for environment-like values', () => {
    expect(
      normalizeStringRecord({
        TOKEN: 'secret',
        RETRIES: 3,
        ENABLED: true,
        EMPTY: null,
      })
    ).toEqual({
      TOKEN: 'secret',
      RETRIES: '3',
      ENABLED: 'true',
    })
    expect(normalizeStringRecord([])).toEqual({})
  })

  it('normalizes record maps by dropping malformed entries', () => {
    expect(
      normalizeRecordMap({
        valid: { type: 'string' },
        invalid: [],
      })
    ).toEqual({
      valid: { type: 'string' },
    })
  })

  it('normalizes legacy workflow variable arrays into records', () => {
    const variableWithId = { id: 'var-1', name: 'brand', type: 'plain', value: 'myfitness' }
    const variableWithName = { name: 'channel', type: 'plain', value: 'whatsapp' }

    expect(normalizeWorkflowVariables([variableWithId, variableWithName, []])).toEqual({
      'var-1': variableWithId,
      channel: variableWithName,
    })
    expect(normalizeWorkflowVariables({ existing: variableWithId })).toEqual({
      existing: variableWithId,
    })
    expect(normalizeWorkflowVariables('not-a-record')).toEqual({})
  })
})
