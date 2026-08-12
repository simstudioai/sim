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
})
