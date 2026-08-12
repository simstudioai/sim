import { auditMock } from '@sim/testing'
import { describe, expect, it } from 'vitest'
import { auditUpdatedFields } from './updated-fields'

describe('auditUpdatedFields', () => {
  it('returns the written columns', () => {
    expect(auditUpdatedFields({ name: 'Renamed', url: 'https://example.com' })).toEqual([
      'name',
      'url',
    ])
  })

  it('drops updatedAt, which every write moves', () => {
    expect(auditUpdatedFields({ name: 'Renamed', updatedAt: new Date() })).toEqual(['name'])
  })

  it('keeps columns explicitly written as null — clearing a value is a change', () => {
    expect(auditUpdatedFields({ lastConnected: null, lastError: null })).toEqual([
      'lastConnected',
      'lastError',
    ])
  })

  it('returns an empty list when only updatedAt was written', () => {
    expect(auditUpdatedFields({ updatedAt: new Date() })).toEqual([])
  })

  /**
   * `auditMock` carries its own copy because `@sim/audit` devDepends on
   * `@sim/testing` — importing the real helper there would close a package
   * cycle. The copy is pinned from this side instead, where the dependency
   * already runs the safe direction.
   */
  it('stays in step with the copy @sim/testing hands to mocked callers', () => {
    const cases: object[] = [
      { name: 'Renamed', url: 'https://example.com' },
      { name: 'Renamed', updatedAt: new Date() },
      { lastConnected: null, lastError: null },
      { updatedAt: new Date() },
      {},
    ]
    for (const updateValues of cases) {
      expect(auditMock.auditUpdatedFields(updateValues)).toEqual(auditUpdatedFields(updateValues))
    }
  })
})
