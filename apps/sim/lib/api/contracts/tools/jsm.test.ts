/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  jsmApprovalsBodySchema,
  jsmCommentsBodySchema,
  jsmCustomersBodySchema,
  jsmIssuePaginationBodySchema,
  jsmParticipantsBodySchema,
  jsmQueuesBodySchema,
  jsmRequestsBodySchema,
  jsmRequestTypesToolBodySchema,
  jsmServiceDeskScopedBodySchema,
  jsmServiceDesksBodySchema,
} from '@/lib/api/contracts/tools/jsm'

const credentials = {
  domain: 'example.atlassian.net',
  accessToken: 'token-123',
}

/**
 * The JSM tools declare `start`/`limit` as `type: 'number'`, so both the agent tool-call path
 * and the block's `toOptionalInt` coercion post numbers to these routes. The contract must
 * accept them and hand the route a string for `URLSearchParams`.
 */
const paginatedSchemas = [
  ['jsmServiceDesksBodySchema', jsmServiceDesksBodySchema, {}],
  ['jsmServiceDeskScopedBodySchema', jsmServiceDeskScopedBodySchema, { serviceDeskId: '1' }],
  ['jsmQueuesBodySchema', jsmQueuesBodySchema, { serviceDeskId: '1' }],
  ['jsmRequestTypesToolBodySchema', jsmRequestTypesToolBodySchema, { serviceDeskId: '1' }],
  ['jsmRequestsBodySchema', jsmRequestsBodySchema, {}],
  ['jsmCommentsBodySchema', jsmCommentsBodySchema, { issueIdOrKey: 'SD-123' }],
  ['jsmIssuePaginationBodySchema', jsmIssuePaginationBodySchema, { issueIdOrKey: 'SD-123' }],
  ['jsmApprovalsBodySchema', jsmApprovalsBodySchema, { action: 'list', issueIdOrKey: 'SD-123' }],
  [
    'jsmParticipantsBodySchema',
    jsmParticipantsBodySchema,
    { action: 'list', issueIdOrKey: 'SD-123' },
  ],
  ['jsmCustomersBodySchema', jsmCustomersBodySchema, { serviceDeskId: '1' }],
] as const

describe('JSM contract pagination', () => {
  it.each(paginatedSchemas)('%s accepts numeric start/limit', (_name, schema, extra) => {
    const parsed = schema.parse({ ...credentials, ...extra, start: 50, limit: 25 })

    expect(parsed.start).toBe('50')
    expect(parsed.limit).toBe('25')
  })

  it.each(paginatedSchemas)('%s still accepts string start/limit', (_name, schema, extra) => {
    const parsed = schema.parse({ ...credentials, ...extra, start: '50', limit: '25' })

    expect(parsed.start).toBe('50')
    expect(parsed.limit).toBe('25')
  })

  it('rejects numbers outside the int32 range Atlassian documents', () => {
    const body = { ...credentials, issueIdOrKey: 'SD-123' }

    expect(() => jsmCommentsBodySchema.parse({ ...body, limit: 2.5 })).toThrow()
    expect(() => jsmCommentsBodySchema.parse({ ...body, start: -1 })).toThrow()
    expect(() => jsmCommentsBodySchema.parse({ ...body, limit: Number.NaN })).toThrow()
    expect(() => jsmCommentsBodySchema.parse({ ...body, limit: 2147483648 })).toThrow()
    expect(jsmCommentsBodySchema.parse({ ...body, limit: 2147483647 }).limit).toBe('2147483647')
    expect(jsmCommentsBodySchema.parse({ ...body, start: 0 }).start).toBe('0')
  })

  /**
   * The string branch is deliberately unconstrained: the previous schema was a bare
   * `z.string()`, so narrowing it would turn bodies that parse today into 400s.
   */
  it('still accepts arbitrary strings the previous schema allowed', () => {
    const body = { ...credentials, issueIdOrKey: 'SD-123' }

    expect(jsmCommentsBodySchema.parse({ ...body, limit: 'twenty' }).limit).toBe('twenty')
    expect(jsmCommentsBodySchema.parse({ ...body, start: '' }).start).toBe('')
    expect(jsmCommentsBodySchema.parse({ ...body, start: '-5' }).start).toBe('-5')
  })

  it('leaves omitted pagination undefined', () => {
    const parsed = jsmCommentsBodySchema.parse({ ...credentials, issueIdOrKey: 'SD-123' })

    expect(parsed.start).toBeUndefined()
    expect(parsed.limit).toBeUndefined()
  })
})

describe('JSM queues includeCount', () => {
  /** The tool declares `includeCount` as a boolean and the block always sends one. */
  it.each([
    [true, 'true'],
    [false, 'false'],
  ])('accepts the boolean %s', (input, expected) => {
    const parsed = jsmQueuesBodySchema.parse({
      ...credentials,
      serviceDeskId: '1',
      includeCount: input,
    })

    expect(parsed.includeCount).toBe(expected)
  })

  it('still accepts the string form sent by hand-authored callers', () => {
    const parsed = jsmQueuesBodySchema.parse({
      ...credentials,
      serviceDeskId: '1',
      includeCount: 'true',
    })

    expect(parsed.includeCount).toBe('true')
  })
})
