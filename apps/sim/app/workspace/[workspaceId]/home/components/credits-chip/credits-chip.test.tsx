/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockHostContext, mockPush, mockSession, mockUseWorkspaceCreditAvailability } = vi.hoisted(
  () => ({
    mockHostContext: {
      current: {
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
          permission: 'write',
          isHostOrganizationMember: false,
          isHostOrganizationAdmin: false,
        },
      },
    },
    mockPush: vi.fn(),
    mockSession: { current: { user: { id: 'external-a' } } },
    mockUseWorkspaceCreditAvailability: vi.fn(),
  })
)

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-b' }),
  useRouter: () => ({ prefetch: vi.fn(), push: mockPush }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({}),
}))

vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: mockSession.current }),
}))

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useWorkspaceHostContext: () => mockHostContext.current,
}))

vi.mock('@/hooks/queries/workspace-usage', () => ({
  useWorkspaceCreditAvailability: mockUseWorkspaceCreditAvailability,
}))

vi.mock('@/hooks/queries/workspace', () => ({
  prefetchWorkspaceSettings: vi.fn(),
}))

import { CreditsChip } from '@/app/workspace/[workspaceId]/home/components/credits-chip/credits-chip'

let container: HTMLDivElement
let root: Root

beforeAll(() => {
  setEnvFlags({ isBillingEnabled: true })
})

afterAll(resetEnvFlagsMock)

describe('CreditsChip', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockUseWorkspaceCreditAvailability.mockReturnValue({
      data: { remainingDollars: 20, scope: 'member' },
      isLoading: false,
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('shows external members workspace-effective credits without an upgrade control', async () => {
    await act(async () => {
      root.render(<CreditsChip />)
    })

    expect(container.querySelector('[aria-label="Workspace credits remaining"]')).not.toBeNull()
    expect(container.querySelector('[aria-label*="upgrade plan"]')).toBeNull()
    expect(mockUseWorkspaceCreditAvailability).toHaveBeenCalledWith('workspace-b')
  })

  it('shows opaque availability instead of a false unlimited balance', async () => {
    mockUseWorkspaceCreditAvailability.mockReturnValue({
      data: { remainingDollars: null, scope: 'effective' },
      isLoading: false,
    })

    await act(async () => {
      root.render(<CreditsChip />)
    })

    expect(container.textContent).toContain('Available')
    expect(container.textContent).not.toContain('∞')
  })

  it('allows target-organization admins to open workspace upgrade pricing', async () => {
    mockSession.current = { user: { id: 'admin-b' } }
    mockHostContext.current = {
      ...mockHostContext.current,
      viewer: {
        permission: 'admin',
        isHostOrganizationMember: true,
        isHostOrganizationAdmin: true,
      },
    }

    await act(async () => {
      root.render(<CreditsChip />)
    })

    const upgradeButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Workspace credits remaining — upgrade plan"]'
    )
    expect(upgradeButton).not.toBeNull()

    act(() => upgradeButton?.click())
    expect(mockPush).toHaveBeenCalledWith('/workspace/workspace-b/upgrade?reason=credits')
  })
})
