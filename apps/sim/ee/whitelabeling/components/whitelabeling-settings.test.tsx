/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseOrganizationBilling } = vi.hoisted(() => ({
  mockUseOrganizationBilling: vi.fn(),
}))

/** Billing on, so plan entitlement gates the page; read through the deployment shape. */
beforeAll(() => setEnvFlags({ isBillingEnabled: true }))
afterAll(resetEnvFlagsMock)
vi.mock('@/components/settings/save-discard-actions', () => ({
  saveDiscardActions: () => [],
}))
vi.mock('@/app/workspace/[workspaceId]/components/credential-detail', () => ({
  CHIP_FIELD_INPUT: '',
  CHIP_FIELD_SHELL: '',
}))
vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-empty-state', () => ({
  SettingsEmptyState: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section',
  () => ({
    SettingsSection: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
  })
)
vi.mock('@/app/workspace/[workspaceId]/settings/hooks/use-profile-picture-upload', () => ({
  useProfilePictureUpload: () => ({ isUploading: false, uploadProfilePicture: vi.fn() }),
}))
vi.mock('@/app/workspace/[workspaceId]/settings/hooks/use-settings-unsaved-guard', () => ({
  useSettingsUnsavedGuard: vi.fn(),
}))
vi.mock('@/ee/components/setting-row', () => ({
  SettingRow: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/ee/whitelabeling/hooks/whitelabel', () => ({
  useUpdateWhitelabelSettings: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useWhitelabelSettings: () => ({ data: {}, error: null, isLoading: false }),
}))
vi.mock('@/hooks/queries/organization', () => ({
  useOrganizationBilling: mockUseOrganizationBilling,
}))
vi.mock('@/hooks/queries/workspace', () => ({
  useWorkspacesQuery: () => ({ data: [] }),
}))

import { WhitelabelingSettings } from '@/ee/whitelabeling/components/whitelabeling-settings'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('WhitelabelingSettings entitlement states', () => {
  it('shows a billing failure instead of an Enterprise notice when access is unknown', () => {
    mockUseOrganizationBilling.mockReturnValue({
      data: undefined,
      error: new Error('Whitelabel billing failed'),
      isPending: false,
    })

    act(() => root.render(<WhitelabelingSettings organizationId='org-1' />))

    expect(container.textContent).toContain('Whitelabel billing failed')
    expect(container.textContent).not.toContain('available on Enterprise plans only')
  })

  it('preserves the Enterprise notice for a successful non-entitled response', () => {
    mockUseOrganizationBilling.mockReturnValue({
      data: { data: { subscriptionPlan: 'free' } },
      error: null,
      isPending: false,
    })

    act(() => root.render(<WhitelabelingSettings organizationId='org-1' />))

    expect(container.textContent).toContain('available on Enterprise plans only')
  })
})
