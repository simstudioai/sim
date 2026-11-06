import { describe, expect, it } from 'vitest'
import {
  greenhouseBody,
  greenhouseListUrl,
  mapGreenhouseFields,
  readGreenhouseRecord,
} from '@/tools/greenhouse/v2_utils'

describe('Greenhouse v3 wire boundaries', () => {
  const dateRules = { created_at: { type: 'object' }, updated_at: { type: 'object' } }

  it('encodes date-range operators in the documented pipe-delimited query value', () => {
    const url = new URL(
      greenhouseListUrl(
        'applications',
        { created_at: { gte: '2024-01-01T00:00:00Z', lt: '2024-02-01T00:00:00Z' } },
        dateRules
      )
    )
    expect([...url.searchParams.entries()]).toEqual([
      ['created_at', 'gte|2024-01-01T00:00:00Z|lt|2024-02-01T00:00:00Z'],
    ])
  })

  it('rejects incompatible initial date filters but preserves cursor-only continuation', () => {
    const filters = {
      created_at: { gte: '2024-01-01T00:00:00Z' },
      updated_at: { gte: '2024-01-01T00:00:00Z' },
    }
    expect(() => greenhouseListUrl('applications', filters, dateRules)).toThrow(
      'created_at and updated_at cannot be combined'
    )
    const continuation = new URL(
      greenhouseListUrl('applications', { ...filters, cursor: 'opaque+/=&value' }, dateRules)
    )
    expect([...continuation.searchParams.entries()]).toEqual([['cursor', 'opaque+/=&value']])
  })

  it('normalizes an embedded application without changing the caller-owned input', () => {
    const application = Object.freeze({ job_id: '123', prospect: 'false' })
    const result = greenhouseBody(
      { application },
      { application: { type: 'object' } },
      'create_candidate'
    )
    expect(JSON.stringify(result)).toBe('{"application":{"job_id":123}}')
    expect(application).toEqual({ job_id: '123', prospect: 'false' })
  })

  it('normalizes embedded prospect flags and placement IDs before choosing the application type', () => {
    const result = greenhouseBody(
      { application: { prospect: 'true', prospect_pool_id: '123', job_ids: [456] } },
      { application: { type: 'object' } },
      'create_candidate'
    )
    expect(result).toEqual({
      application: { prospect: true, prospect_pool_id: 123, job_ids: [456] },
    })
  })

  it('preserves absent arrays in partial reads without turning them into replacements', () => {
    const fields = {
      email_addresses: { type: 'array', items: { type: 'string' } },
      tags: { type: 'array', items: { type: 'string' } },
    } as const
    expect(mapGreenhouseFields({ tags: [] }, fields)).toEqual({
      email_addresses: null,
      tags: [],
    })
    expect(() => mapGreenhouseFields({ tags: {} }, fields)).toThrow(
      'Greenhouse returned an invalid array field: tags'
    )
  })

  it.each([['123'], [1.5], [{}]])('rejects noninteger JSON ID array entries', (value) => {
    expect(() =>
      greenhouseBody(
        { linked_user_ids: [value] },
        { linked_user_ids: { type: 'array', integerItems: true } },
        'update_candidate'
      )
    ).toThrow('linked_user_ids must contain integer IDs')
  })

  it.each([
    { payload: { id: '123' }, marker: 'id' },
    { payload: { message: {} }, marker: 'message' },
    { payload: { candidate: true }, marker: 'candidate' },
    { payload: { candidate: { id: '123' } }, marker: 'candidate' },
  ])('rejects malformed successful mutation envelopes', async ({ payload, marker }) => {
    await expect(readGreenhouseRecord(Response.json(payload), marker)).rejects.toThrow(
      'Greenhouse returned an invalid resource response'
    )
  })
})
