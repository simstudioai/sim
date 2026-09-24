/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  assertSearchIndexesActive,
  isIndexedOrgSearchEnabled,
  SearchIndexDormantError,
} from '@/lib/sim-search/indexed/gate'

describe('indexed organization search gate', () => {
  beforeEach(resetEnvFlagsMock)

  it('is dormant while Live Search is the backend', () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    expect(isIndexedOrgSearchEnabled()).toBe(false)
  })

  it('is on only when Live Search is turned off', () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: false })
    expect(isIndexedOrgSearchEnabled()).toBe(true)
  })

  it('refuses any search index while dormant and never a workspace knowledge base', () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    expect(() =>
      assertSearchIndexesActive([{ isSearchIndex: false }, { isSearchIndex: true }])
    ).toThrow(SearchIndexDormantError)
    expect(() =>
      assertSearchIndexesActive([{ isSearchIndex: false }, { isSearchIndex: null }, {}])
    ).not.toThrow()
  })

  it('admits search indexes while indexed organization search is on', () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: false })
    expect(() => assertSearchIndexesActive([{ isSearchIndex: true }])).not.toThrow()
  })
})
