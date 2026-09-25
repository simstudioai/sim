import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

import { resolveTinKeywordQuery } from '@/lib/knowledge/search/tin-keyword'

featureFlagsMockFns.mockIsFeatureEnabled.mockResolvedValue(true)

/** Its own file, so the process-wide readiness cache starts empty. */
it('stays on the GIN projection while the Tin index is incomplete, and remembers that', async () => {
  resetDbChainMock()
  let indexValid = false
  dbChainMockFns.execute.mockImplementation(async (query) => {
    const text = JSON.stringify(query)
    if (text.includes('indisvalid')) return [{ valid: indexValid }]
    if (text.includes('websearch_to_tsquery')) return [{ rendered: "'releas'" }]
    return []
  })
  expect(await resolveTinKeywordQuery(true, 'release', 'english', undefined)).toBeNull()
  indexValid = true
  expect(await resolveTinKeywordQuery(true, 'release', 'english', undefined)).toBeNull()
  const readinessReads = dbChainMockFns.execute.mock.calls.filter(([query]) =>
    JSON.stringify(query).includes('indisvalid')
  )
  expect(readinessReads).toHaveLength(1)
})
