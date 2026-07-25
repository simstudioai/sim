/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson } = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

import {
  getWorkspaceCreditAvailabilityContract,
  getWorkspaceUsageGateContract,
} from '@/lib/api/contracts/workspaces'
import {
  fetchWorkspaceCreditAvailability,
  fetchWorkspaceUsageGate,
  WORKSPACE_CREDIT_AVAILABILITY_STALE_TIME,
  WORKSPACE_USAGE_GATE_STALE_TIME,
  workspaceUsageKeys,
} from '@/hooks/queries/workspace-usage'

describe('workspace usage gate query', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keys by routed workspace and forwards request cancellation', async () => {
    const signal = new AbortController().signal
    const response = { isExceeded: false, message: null, scope: null }
    mockRequestJson.mockResolvedValue(response)

    await expect(fetchWorkspaceUsageGate('workspace-b', signal)).resolves.toEqual(response)

    expect(workspaceUsageKeys.gate('workspace-b')).toEqual([
      'workspace-usage',
      'gate',
      'workspace-b',
    ])
    expect(WORKSPACE_USAGE_GATE_STALE_TIME).toBeGreaterThan(0)
    expect(mockRequestJson).toHaveBeenCalledWith(getWorkspaceUsageGateContract, {
      params: { id: 'workspace-b' },
      signal,
    })
  })

  it('keys credit availability by workspace and forwards request cancellation', async () => {
    const signal = new AbortController().signal
    const response = { remainingDollars: 20, scope: 'member' as const }
    mockRequestJson.mockResolvedValue(response)

    await expect(fetchWorkspaceCreditAvailability('workspace-b', signal)).resolves.toEqual(response)

    expect(workspaceUsageKeys.creditAvailability('workspace-b')).toEqual([
      'workspace-usage',
      'credit-availability',
      'workspace-b',
    ])
    expect(WORKSPACE_CREDIT_AVAILABILITY_STALE_TIME).toBeGreaterThan(0)
    expect(mockRequestJson).toHaveBeenCalledWith(getWorkspaceCreditAvailabilityContract, {
      params: { id: 'workspace-b' },
      signal,
    })
  })
})
