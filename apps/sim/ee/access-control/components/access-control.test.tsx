/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseOrganizationBilling, mockUseUserPermissionConfig, mockUsePermissionGroups } =
  vi.hoisted(() => ({
    mockUseOrganizationBilling: vi.fn(),
    mockUseUserPermissionConfig: vi.fn(),
    mockUsePermissionGroups: vi.fn(),
  }))

vi.mock('@sim/emcn', () => ({
  Checkbox: () => null,
  ChipModal: ({ children }: { children?: ReactNode }) => <>{children}</>,
  ChipModalBody: ({ children }: { children?: ReactNode }) => <>{children}</>,
  ChipModalError: () => null,
  ChipModalField: ({ children }: { children?: ReactNode }) => <>{children}</>,
  ChipModalFooter: () => null,
  ChipModalHeader: ({ children }: { children?: ReactNode }) => <>{children}</>,
  ChipTag: () => null,
  Label: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))
vi.mock('@sim/emcn/icons', () => ({ Plus: () => null }))
vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
}))
vi.mock('nuqs', () => ({ useQueryState: () => [null, vi.fn()] }))
vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-empty-state', () => ({
  SettingsEmptyState: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SettingsQueryErrorState: ({ error, onRetry }: { error: Error; onRetry: () => void }) => (
    <div>
      {error.message}
      <button type='button' onClick={onRetry}>
        Try again
      </button>
    </div>
  ),
}))
vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
}))
vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-resource-row', () => ({
  RESOURCE_LIST_STACK: '',
  SettingsResourceRow: () => null,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section',
  () => ({
    SettingsSection: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
  })
)
vi.mock('@/app/workspace/[workspaceId]/settings/components/use-settings-search', () => ({
  useSettingsSearch: () => ['', vi.fn()],
}))
vi.mock('@/ee/access-control/components/group-detail', () => ({ GroupDetail: () => null }))
vi.mock('@/ee/access-control/components/workspace-select', () => ({ WorkspaceSelect: () => null }))
vi.mock('@/ee/access-control/hooks/permission-groups', () => ({
  useCreatePermissionGroup: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useOrganizationWorkspaces: () => ({ data: [], isPending: false }),
  usePermissionGroups: mockUsePermissionGroups,
  useUserPermissionConfig: mockUseUserPermissionConfig,
}))
vi.mock('@/hooks/queries/organization', () => ({
  useOrganizationBilling: mockUseOrganizationBilling,
}))

import { AccessControl } from '@/ee/access-control/components/access-control'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mockUsePermissionGroups.mockReturnValue({ data: [], isPending: false, error: null })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('AccessControl entitlement states', () => {
  it('shows a retryable list failure instead of claiming there are no permission groups', async () => {
    const refetch = vi.fn()
    mockUseUserPermissionConfig.mockReturnValue({ data: { entitled: true }, isPending: false })
    mockUseOrganizationBilling.mockReturnValue({ data: undefined, isPending: false })
    mockUsePermissionGroups.mockReturnValue({
      error: new Error('Groups unavailable'),
      isPending: false,
      isFetching: false,
      refetch,
    })
    act(() => root.render(<AccessControl isOrganizationAdmin organizationId='org-1' />))
    expect(container.textContent).toContain('Groups unavailable')
    expect(container.textContent).not.toContain('No permission groups yet')
    await act(async () => container.querySelector('button')?.click())
    expect(refetch).toHaveBeenCalledOnce()

    mockUsePermissionGroups.mockReturnValue({ data: [], isPending: false, error: null })
    act(() => root.render(<AccessControl isOrganizationAdmin organizationId='org-1' />))
    expect(container.textContent).toContain('No permission groups yet')
    expect(container.textContent).not.toContain('Groups unavailable')
  })
  it('shows a billing failure instead of a plan notice when access is unknown', () => {
    mockUseUserPermissionConfig.mockReturnValue({
      data: { entitled: false },
      error: null,
      isPending: false,
    })
    mockUseOrganizationBilling.mockReturnValue({
      data: undefined,
      error: new Error('Access Control billing failed'),
      isPending: false,
    })

    act(() => root.render(<AccessControl isOrganizationAdmin organizationId='org-1' />))

    expect(container.textContent).toContain('Access Control billing failed')
    expect(container.textContent).not.toContain('Only organization admins on Enterprise plans')
  })

  it('preserves the plan notice when both entitlement reads succeed', () => {
    mockUseUserPermissionConfig.mockReturnValue({
      data: { entitled: false },
      error: null,
      isPending: false,
    })
    mockUseOrganizationBilling.mockReturnValue({
      data: { data: { subscriptionPlan: 'free' } },
      error: null,
      isPending: false,
    })

    act(() => root.render(<AccessControl isOrganizationAdmin organizationId='org-1' />))

    expect(container.textContent).toContain('Only organization admins on Enterprise plans')
  })
})
