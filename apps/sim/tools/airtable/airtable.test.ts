/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { airtableCreateRecordsTool } from '@/tools/airtable/create_records'
import { airtableUpdateMultipleRecordsTool } from '@/tools/airtable/update_multiple_records'
import { airtableUpdateRecordTool } from '@/tools/airtable/update_record'
import { airtableUpsertRecordsTool } from '@/tools/airtable/upsert_records'

const nestedFields = {
  StringBoolean: 'false',
  StringNumber: '42',
  Boolean: true,
  Number: 42,
  Nested: {
    values: ['true', false, '001'],
  },
}

const baseParams = {
  accessToken: 'token',
  baseId: 'app123',
  tableId: 'tbl123',
}

const requestCases = [
  {
    operation: 'create records',
    buildBody: (typecast?: boolean) =>
      airtableCreateRecordsTool.request.body!({
        ...baseParams,
        records: [{ fields: nestedFields }],
        typecast,
      }),
    body: {
      records: [{ fields: nestedFields }],
    },
  },
  {
    operation: 'update record',
    buildBody: (typecast?: boolean) =>
      airtableUpdateRecordTool.request.body!({
        ...baseParams,
        recordId: 'rec123',
        fields: nestedFields,
        typecast,
      }),
    body: {
      fields: nestedFields,
    },
  },
  {
    operation: 'update multiple records',
    buildBody: (typecast?: boolean) =>
      airtableUpdateMultipleRecordsTool.request.body!({
        ...baseParams,
        records: [{ id: 'rec123', fields: nestedFields }],
        typecast,
      }),
    body: {
      records: [{ id: 'rec123', fields: nestedFields }],
    },
  },
  {
    operation: 'upsert records',
    buildBody: (typecast?: boolean) =>
      airtableUpsertRecordsTool.request.body!({
        ...baseParams,
        records: [{ fields: nestedFields }],
        fieldsToMergeOn: ['External ID'],
        typecast,
      }),
    body: {
      performUpsert: { fieldsToMergeOn: ['External ID'] },
      records: [{ fields: nestedFields }],
    },
  },
] as const

describe.each(requestCases)('Airtable $operation request body', ({ buildBody, body }) => {
  it('omits typecast when unset and preserves nested values', () => {
    expect(buildBody()).toEqual(body)
  })

  it('includes typecast true at the request-body root', () => {
    expect(buildBody(true)).toEqual({ ...body, typecast: true })
  })

  it('includes typecast false at the request-body root', () => {
    expect(buildBody(false)).toEqual({ ...body, typecast: false })
  })
})
