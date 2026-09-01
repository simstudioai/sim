/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { applyOnePasswordPatch } from '@/lib/internal/onepassword/json-patch'

describe('applyOnePasswordPatch', () => {
  it('resolves array segments by 1Password ID before numeric index', () => {
    const item: Record<string, unknown> = {
      fields: [
        { id: '1', value: 'by-id' },
        { id: 'other', value: 'by-index' },
      ],
    }

    applyOnePasswordPatch(item, {
      op: 'replace',
      path: '/fields/1/value',
      value: 'updated-by-id',
    })

    expect(item.fields).toEqual([
      { id: '1', value: 'updated-by-id' },
      { id: 'other', value: 'by-index' },
    ])
  })

  it('supports append and remove operations', () => {
    const item: Record<string, unknown> = { tags: ['one'] }

    applyOnePasswordPatch(item, { op: 'add', path: '/tags/-', value: 'two' })
    applyOnePasswordPatch(item, { op: 'remove', path: '/tags/0' })

    expect(item.tags).toEqual(['two'])
  })
})
