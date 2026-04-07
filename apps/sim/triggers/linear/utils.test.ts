/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { isLinearEventMatch } from '@/triggers/linear/utils'

describe('isLinearEventMatch', () => {
  it('returns false for unknown trigger ids (fail closed)', () => {
    expect(isLinearEventMatch('linear_unknown_trigger', 'Issue', 'create')).toBe(false)
  })

  it('returns true when type and action match a known trigger', () => {
    expect(isLinearEventMatch('linear_issue_created', 'Issue', 'create')).toBe(true)
  })

  it('normalizes _v2 suffix when matching', () => {
    expect(isLinearEventMatch('linear_issue_created_v2', 'Issue', 'create')).toBe(true)
  })
})
