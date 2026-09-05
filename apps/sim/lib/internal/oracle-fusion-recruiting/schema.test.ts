/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import * as schemas from '@/lib/internal/oracle-fusion-recruiting/schema'

const auth = { instanceUrl: 'https://example.fa.ocs.oraclecloud.com', accessToken: 'test-token' }
describe('Recruiting schemas', () => {
  it.each(['0', '-1', '1.5', '1e3', '9223372036854775808', '1;Other=2'])(
    'rejects invalid numeric ID %s',
    (id) => {
      expect(schemas.decimalIdSchema.safeParse(id).success).toBe(false)
    }
  )
  it('retains int64 precision and trims input IDs', () => {
    expect(schemas.decimalIdSchema.parse(' 9007199254740993 ')).toBe('9007199254740993')
  })
  it.each(['1;Other=2', '1,Other=2', '../1', 'a/b', 'a%2fb'])(
    'rejects unsafe string ID %s',
    (id) => {
      expect(schemas.stringIdSchema.safeParse(id).success).toBe(false)
    }
  )
  it.each([0, -1, 101, 1.5])('rejects invalid page limit %s', (limit) => {
    expect(schemas.listCandidatesSchema.safeParse({ ...auth, limit }).success).toBe(false)
  })
  it('requires the documented requisition creation fields', () => {
    expect(schemas.createRequisitionFieldsSchema.safeParse({ Title: 'Engineer' }).success).toBe(
      false
    )
  })
  it('rejects unknown fields and nested mutations', () => {
    expect(schemas.createCandidateFieldsSchema.safeParse({ candidatePhones: [] }).success).toBe(
      false
    )
    expect(schemas.updatePhoneFieldsSchema.safeParse({ PhoneType: 'Mobile' }).success).toBe(false)
    expect(schemas.updateCandidateFieldsSchema.safeParse({}).success).toBe(false)
  })
  it('preserves omitted versus explicitly cleared fields', () => {
    expect(schemas.updateCandidateFieldsSchema.parse({ Email: null })).toEqual({ Email: null })
    expect(schemas.updateCandidateFieldsSchema.parse({ FirstName: 'Taylor' })).not.toHaveProperty(
      'Email'
    )
  })
  it('rejects numeric JS values for int64 write fields', () => {
    expect(
      schemas.updateRequisitionFieldsSchema.safeParse({ RecruiterId: 9007199254740992 }).success
    ).toBe(false)
  })
})
