/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  parseWorkspaceRecency,
  serializeWorkspaceRecency,
  sortByRecentIds,
} from '@/lib/workspaces/recency-cookie'

describe('workspace recency cookie', () => {
  it('serializes visits most recent first and round-trips through parse', () => {
    const value = serializeWorkspaceRecency({ a: 1, b: 3, c: 2 })
    expect(value).toBe('b.c.a')
    expect(parseWorkspaceRecency(value)).toEqual(['b', 'c', 'a'])
  })

  it('caps the cookie to the most recent twenty workspaces', () => {
    const visits = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`ws-${i}`, i]))
    const ids = parseWorkspaceRecency(serializeWorkspaceRecency(visits))
    expect(ids).toHaveLength(20)
    expect(ids[0]).toBe('ws-29')
  })

  it('drops malformed ids from a tampered cookie', () => {
    expect(parseWorkspaceRecency('ok-1.<script>..ok_2')).toEqual(['ok-1', 'ok_2'])
    expect(parseWorkspaceRecency(undefined)).toEqual([])
  })

  it('orders tracked items first and keeps untracked items in incoming order', () => {
    const items = [{ id: 'n1' }, { id: 't2' }, { id: 'n2' }, { id: 't1' }]
    expect(sortByRecentIds(items, ['t1', 't2']).map(({ id }) => id)).toEqual([
      't1',
      't2',
      'n1',
      'n2',
    ])
    expect(sortByRecentIds(items, [])).toBe(items)
  })
})
