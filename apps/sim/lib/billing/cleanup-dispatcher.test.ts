/**
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  resetDbChainMock,
  resetEnvFlagsMock,
  setEnvFlags,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsTriggerAvailable } = vi.hoisted(() => ({
  mockIsTriggerAvailable: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@/lib/billing/core/billing', () => ({ getOrganizationSubscription: vi.fn() }))
vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPriorityPersonalSubscription: vi.fn(),
}))
vi.mock('@/lib/cleanup/batch-delete', () => ({ chunkArray: vi.fn() }))
vi.mock('@/lib/core/async-jobs', () => ({ getJobQueue: vi.fn() }))
vi.mock('@/lib/core/async-jobs/config', () => ({ shouldExecuteInline: vi.fn(() => false) }))
vi.mock('@/lib/core/async-jobs/region', () => ({ resolveTriggerRegion: vi.fn() }))
vi.mock('@/lib/knowledge/documents/service', () => ({
  isTriggerAvailable: mockIsTriggerAvailable,
}))
vi.mock('@/lib/workspaces/policy', () => ({
  WORKSPACE_MODE: { PERSONAL: 'personal', ORGANIZATION: 'organization' },
  isOrganizationWorkspace: vi.fn(),
}))

import { dispatchCleanupJobs } from '@/lib/billing/cleanup-dispatcher'

afterAll(resetEnvFlagsMock)

describe('dispatchCleanupJobs billing gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnvFlags({ isBillingEnabled: false })
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('never dispatches plan-based retention deletion when billing is disabled', async () => {
    const result = await dispatchCleanupJobs('cleanup-logs')

    expect(result).toEqual({ jobIds: [], jobCount: 0, chunkCount: 0, workspaceCount: 0 })
    expect(mockIsTriggerAvailable).not.toHaveBeenCalled()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})
