/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { matchesRule, normalizeRule, parseGateConfig } from '@/lib/core/config/appconfig-rules'

describe('normalizeRule', () => {
  it('returns null for non-object values', () => {
    expect(normalizeRule('nope')).toBeNull()
    expect(normalizeRule(null)).toBeNull()
    expect(normalizeRule(42)).toBeNull()
  })

  it('keeps only boolean enabled/adminEnabled', () => {
    expect(normalizeRule({ enabled: 'true', adminEnabled: 1 })).toEqual({})
    expect(normalizeRule({ enabled: true, adminEnabled: false })).toEqual({
      enabled: true,
      adminEnabled: false,
    })
  })

  it('trims, dedupes, and drops empty ids', () => {
    expect(normalizeRule({ orgIds: ['Org_1', ' org_1 ', '', 'org_2'], userIds: 'nope' })).toEqual({
      orgIds: ['Org_1', 'org_1', 'org_2'],
    })
  })
})

describe('parseGateConfig', () => {
  it('drops malformed entries and coerces the rest', () => {
    const rules = parseGateConfig({
      a: { enabled: true },
      b: 'not-an-object',
      c: { userIds: ['u1'] },
    })
    expect(rules.a).toEqual({ enabled: true })
    expect(rules.b).toBeUndefined()
    expect(rules.c).toEqual({ userIds: ['u1'] })
  })

  it('degrades to an empty map on a malformed document', () => {
    expect(parseGateConfig('not-an-object')).toEqual({})
    expect(parseGateConfig(null)).toEqual({})
  })
})

describe('matchesRule', () => {
  it('returns false for a missing rule', () => {
    expect(matchesRule(undefined, { userId: 'u1' }, true)).toBe(false)
  })

  it('matches the global enabled clause', () => {
    expect(matchesRule({ enabled: true }, {}, false)).toBe(true)
    expect(matchesRule({ enabled: false }, {}, false)).toBe(false)
  })

  it('matches the userId and orgId allowlists', () => {
    expect(matchesRule({ userIds: ['u1'] }, { userId: 'u1' }, false)).toBe(true)
    expect(matchesRule({ userIds: ['u1'] }, { userId: 'u2' }, false)).toBe(false)
    expect(matchesRule({ orgIds: ['o1'] }, { orgId: 'o1' }, false)).toBe(true)
    expect(matchesRule({ orgIds: ['o1'] }, {}, false)).toBe(false)
  })

  it('matches the admin clause only with the supplied isAdmin', () => {
    expect(matchesRule({ adminEnabled: true }, { userId: 'u1' }, true)).toBe(true)
    expect(matchesRule({ adminEnabled: true }, { userId: 'u1' }, false)).toBe(false)
    expect(matchesRule({ enabled: false }, { userId: 'u1' }, true)).toBe(false)
  })
})
