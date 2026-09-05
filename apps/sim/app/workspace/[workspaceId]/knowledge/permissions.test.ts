/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { canDeleteKnowledgeBase } from '@/app/workspace/[workspaceId]/knowledge/permissions'

describe('knowledge delete UI permission', () => {
  it.each([
    [true, false, false, false],
    [true, true, false, false],
    [true, true, true, true],
    [false, true, false, true],
    [false, false, false, false],
    [true, false, true, false],
  ])(
    'matches Search identity %s and edit/admin %s/%s',
    (isSearchIndex, canEdit, canAdmin, expected) => {
      expect(canDeleteKnowledgeBase({ isSearchIndex }, { canEdit, canAdmin })).toBe(expected)
    }
  )
  it('offers no deletion before the canonical resource has loaded', () => {
    expect(canDeleteKnowledgeBase(undefined, { canEdit: true, canAdmin: true })).toBe(false)
  })
})
