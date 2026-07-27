/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isCurrentItem } from '@/connectors/webflow/webflow'

describe('isCurrentItem', () => {
  it.concurrent('keeps items explicitly not archived', () => {
    expect(isCurrentItem({ isArchived: false })).toBe(true)
  })

  it.concurrent('excludes items explicitly archived', () => {
    expect(isCurrentItem({ isArchived: true })).toBe(false)
  })

  it.concurrent('keeps items with no archived flag', () => {
    expect(isCurrentItem({})).toBe(true)
  })

  it.concurrent('keeps items whose archived flag is undefined', () => {
    expect(isCurrentItem({ isArchived: undefined })).toBe(true)
  })

  it.concurrent('keeps drafts, which are unpublished but still present in the CMS', () => {
    expect(isCurrentItem({ isArchived: false, isDraft: true } as { isArchived?: boolean })).toBe(
      true
    )
  })

  it.concurrent('excludes archived drafts', () => {
    expect(isCurrentItem({ isArchived: true, isDraft: true } as { isArchived?: boolean })).toBe(
      false
    )
  })

  it.concurrent('keeps items when the flag is a non-boolean truthy value', () => {
    expect(isCurrentItem({ isArchived: 'true' } as unknown as { isArchived?: boolean })).toBe(true)
  })

  it.concurrent('filters only archived items out of a page listing', () => {
    const items = [
      { id: 'a', isArchived: false },
      { id: 'b', isArchived: true },
      { id: 'c' },
      { id: 'd', isDraft: true },
    ]
    expect(items.filter(isCurrentItem).map((i) => i.id)).toEqual(['a', 'c', 'd'])
  })
})
