/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFlags, mockIsTriggerAvailable, mockSelect } = vi.hoisted(() => ({
  mockFlags: { isBillingEnabled: false },
  mockIsTriggerAvailable: vi.fn(),
  mockSelect: vi.fn(),
}))

vi.mock('@sim/db', () => ({ db: { select: mockSelect } }))
vi.mock('@/lib/billing/core/billing', () => ({ getOrganizationSubscription: vi.fn() }))
vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPriorityPersonalSubscription: vi.fn(),
}))
vi.mock('@/lib/cleanup/batch-delete', () => ({ chunkArray: vi.fn() }))
vi.mock('@/lib/core/async-jobs', () => ({ getJobQueue: vi.fn() }))
vi.mock('@/lib/core/async-jobs/config', () => ({ shouldExecuteInline: vi.fn(() => false) }))
vi.mock('@/lib/core/async-jobs/region', () => ({ resolveTriggerRegion: vi.fn() }))
vi.mock('@/lib/core/config/env-flags', () => ({
  get isBillingEnabled() {
    return mockFlags.isBillingEnabled
  },
}))
vi.mock('@/lib/knowledge/documents/service', () => ({
  isTriggerAvailable: mockIsTriggerAvailable,
}))
vi.mock('@/lib/workspaces/policy', () => ({
  WORKSPACE_MODE: { PERSONAL: 'personal', ORGANIZATION: 'organization' },
  isOrganizationWorkspace: vi.fn(),
}))

import { dispatchCleanupJobs } from '@/lib/billing/cleanup-dispatcher'

describe('dispatchCleanupJobs billing gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlags.isBillingEnabled = false
  })

  it('never dispatches plan-based retention deletion when billing is disabled', async () => {
    const result = await dispatchCleanupJobs('cleanup-logs')

    expect(result).toEqual({ jobIds: [], jobCount: 0, chunkCount: 0, workspaceCount: 0 })
    expect(mockIsTriggerAvailable).not.toHaveBeenCalled()
    expect(mockSelect).not.toHaveBeenCalled()
  })
})
