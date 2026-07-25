/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/triggers', () => ({
  getTrigger: () => ({ subBlocks: [] }),
}))

import { AirtableBlock } from '@/blocks/blocks/airtable'

const nestedFields = {
  StringBoolean: 'false',
  StringNumber: '42',
  Boolean: true,
  Number: 42,
  Nested: {
    values: ['true', false, '001'],
  },
}

const records = [{ fields: nestedFields }]
const updateRecords = [{ id: 'rec123', fields: nestedFields }]
const baseParams = {
  oauthCredential: 'credential',
  baseId: 'app123',
  tableId: 'tbl123',
}

const operationCases = [
  {
    operation: 'create',
    params: { records: JSON.stringify(records) },
    payload: { records },
  },
  {
    operation: 'update',
    params: { recordId: 'rec123', fields: JSON.stringify(nestedFields) },
    payload: { fields: nestedFields },
  },
  {
    operation: 'updateMultiple',
    params: { records: JSON.stringify(updateRecords) },
    payload: { records: updateRecords },
  },
  {
    operation: 'upsert',
    params: {
      records: JSON.stringify(records),
      fieldsToMergeOn: JSON.stringify(['External ID']),
    },
    payload: { records, fieldsToMergeOn: ['External ID'] },
  },
] as const

describe('AirtableBlock typecast', () => {
  const buildParams = AirtableBlock.tools.config.params!

  it('exposes typecast as an advanced switch for all write operations', () => {
    expect(AirtableBlock.subBlocks.find(({ id }) => id === 'typecast')).toMatchObject({
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create', 'update', 'updateMultiple', 'upsert'],
      },
    })
  })

  describe.each(operationCases)('$operation params', ({ operation, params, payload }) => {
    it('omits typecast when unset and preserves nested values', () => {
      expect(buildParams({ ...baseParams, operation, ...params })).toMatchObject(payload)
      expect(buildParams({ ...baseParams, operation, ...params })).not.toHaveProperty('typecast')
    })

    it.each([
      { supplied: true, expected: true },
      { supplied: false, expected: false },
      { supplied: 'true', expected: true },
      { supplied: 'false', expected: false },
    ])('coerces only typecast $supplied to $expected', ({ supplied, expected }) => {
      expect(
        buildParams({
          ...baseParams,
          operation,
          ...params,
          typecast: supplied,
        })
      ).toMatchObject({
        ...payload,
        typecast: expected,
      })
    })
  })

  it('does not pass typecast to read or delete operations', () => {
    expect(buildParams({ ...baseParams, operation: 'list', typecast: 'true' })).not.toHaveProperty(
      'typecast'
    )
    expect(
      buildParams({
        ...baseParams,
        operation: 'delete',
        recordIds: JSON.stringify(['rec123']),
        typecast: 'true',
      })
    ).not.toHaveProperty('typecast')
  })
})
