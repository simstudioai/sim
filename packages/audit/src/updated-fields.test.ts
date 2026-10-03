import { describe, expect, it } from 'vitest'
import { auditUpdatedFields } from './updated-fields'

describe('auditUpdatedFields', () => {
  it('keeps columns explicitly written as null — clearing a value is a change', () => {
    expect(auditUpdatedFields({ lastConnected: null, lastError: null })).toEqual([
      'lastConnected',
      'lastError',
    ])
  })
})
