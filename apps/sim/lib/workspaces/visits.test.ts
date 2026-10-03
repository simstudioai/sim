import { resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { sortByVisitRecency } from '@/lib/workspaces/visits'

describe('workspace visits', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('orders visited workspaces first and keeps the rest in incoming order', () => {
    const workspaces = [{ id: 'n1' }, { id: 'v2' }, { id: 'n2' }, { id: 'v1' }]

    expect(sortByVisitRecency(workspaces, ['v1', 'gone', 'v2']).map(({ id }) => id)).toEqual([
      'v1',
      'v2',
      'n1',
      'n2',
    ])
    expect(sortByVisitRecency(workspaces, []).map(({ id }) => id)).toEqual(['n1', 'v2', 'n2', 'v1'])
  })
})
