import { expect, it } from 'vitest'
import { searchFiltersFromParams } from '@/app/workspace/[workspaceId]/home/search-params'

it('normalizes a reversed date deep link to the same local-day range', () => {
  const from = new Date('2026-01-03')
  const to = new Date('2026-01-01')
  expect(searchFiltersFromParams({ source: null, updated: 'custom', from, to }, 0)).toEqual(
    searchFiltersFromParams({ source: null, updated: 'custom', from: to, to: from }, 0)
  )
})
