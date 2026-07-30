/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockHandleUpgrade, mockInvalidateQueries, mockRequestJson, mockToastError } = vi.hoisted(
  () => ({
    mockHandleUpgrade: vi.fn(),
    mockInvalidateQueries: vi.fn(),
    mockRequestJson: vi.fn(),
    mockToastError: vi.fn(),
  })
)

vi.mock('@sim/emcn', () => ({
  toast: { error: mockToastError },
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

vi.mock('@/lib/billing/client/upgrade', () => ({
  useSubscriptionUpgrade: () => ({ handleUpgrade: mockHandleUpgrade }),
}))

import type { WorkspaceHostContext } from '@/lib/api/contracts/workspaces'
import {
  type UpgradeState,
  useUpgradeState,
} from '@/app/workspace/[workspaceId]/upgrade/hooks/use-upgrade-state'

const HOST_CONTEXT: WorkspaceHostContext = {
  workspace: {
    id: 'workspace-b',
    name: 'Workspace B',
    workspaceMode: 'organization',
    billedAccountUserId: 'owner-b',
  },
  hostOrganizationId: 'org-b',
  ownerBilling: {
    plan: 'team_25000',
    status: 'active',
    isPaid: true,
    isPro: false,
    isTeam: true,
    isEnterprise: false,
    isOrgScoped: true,
    organizationId: 'org-b',
    billingInterval: 'month',
    billingBlocked: false,
    billingBlockedReason: null,
  },
  viewer: {
    permission: 'admin',
    isHostOrganizationMember: true,
    isHostOrganizationAdmin: true,
  },
}

let currentState: UpgradeState | null = null

function Harness() {
  currentState = useUpgradeState({
    hostContext: HOST_CONTEXT,
    workspaceId: HOST_CONTEXT.workspace.id,
  })
  return null
}

let container: HTMLDivElement
let root: Root

describe('useUpgradeState', () => {
  beforeEach(() => {
    currentState = null
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockHandleUpgrade.mockResolvedValue(undefined)
    mockInvalidateQueries.mockResolvedValue(undefined)
    mockRequestJson.mockResolvedValue({ success: true })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('derives plan state from the routed workspace host', async () => {
    await act(async () => {
      root.render(<Harness />)
    })

    expect(currentState?.subscription.plan).toBe('team_25000')
    expect(currentState?.subscription.isOrgScoped).toBe(true)
    expect(currentState?.isOnMax).toBe(true)
  })

  it('targets the host organization when upgrading the workspace plan', async () => {
    await act(async () => {
      root.render(<Harness />)
    })

    await act(async () => {
      await currentState?.doUpgrade('team', 25000)
    })

    expect(mockHandleUpgrade).toHaveBeenCalledWith('team', {
      creditTier: 25000,
      annual: false,
      organizationId: 'org-b',
    })
  })

  it('includes the routed workspace when switching the host billing interval', async () => {
    await act(async () => {
      root.render(<Harness />)
    })

    await act(async () => {
      await currentState?.handleSwitchInterval('year')
    })

    expect(mockRequestJson).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: {
          targetPlanName: 'team_25000',
          interval: 'year',
          workspaceId: 'workspace-b',
        },
      })
    )
  })
})
