import { knowledgeBase } from '@sim/db/schema'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  connectorIndexingCondition,
  requiresConnectorIndexing,
} from '@/lib/knowledge/connectors/indexing-policy'

describe('connector indexing policy', () => {
  beforeEach(resetEnvFlagsMock)

  it('preserves ordinary knowledge-base indexing when Search uses live APIs', () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    expect(requiresConnectorIndexing(false)).toBe(true)
    expect(requiresConnectorIndexing(true)).toBe(false)
    connectorIndexingCondition()
    expect(vi.mocked(eq)).toHaveBeenCalledWith(knowledgeBase.isSearchIndex, false)
  })

  it('preserves indexed Search and existing schedules when live search is disabled', () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: false })
    expect(requiresConnectorIndexing(true)).toBe(true)
    expect(requiresConnectorIndexing(false)).toBe(true)
    expect(connectorIndexingCondition()).toBeUndefined()
  })
})
