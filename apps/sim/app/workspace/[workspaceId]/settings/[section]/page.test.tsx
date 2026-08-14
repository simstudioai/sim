/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCanOpenOrganizationSettingsSection,
  mockGetSession,
  mockGetWorkspaceHostContext,
  mockHasWorkspaceInboxAccess,
  mockHasWorkspaceSandboxAccess,
  mockIsForkingAvailable,
  mockIsOrganizationOnEnterprisePlan,
  mockIsOrganizationSettingsSectionAvailable,
  mockNotFound,
  mockRedirect,
  mockResolveWorkspaceGroup,
  mockResolveWorkspaceNavigation,
} = vi.hoisted(() => ({
  mockCanOpenOrganizationSettingsSection: vi.fn(),
  mockGetSession: vi.fn(),
  mockGetWorkspaceHostContext: vi.fn(),
  mockHasWorkspaceInboxAccess: vi.fn(),
  mockHasWorkspaceSandboxAccess: vi.fn(),
  mockIsForkingAvailable: vi.fn(),
  mockIsOrganizationOnEnterprisePlan: vi.fn(),
  mockIsOrganizationSettingsSectionAvailable: vi.fn(),
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  mockRedirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`)
  }),
  mockResolveWorkspaceGroup: vi.fn(),
  mockResolveWorkspaceNavigation: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  notFound: mockNotFound,
  redirect: mockRedirect,
}))

vi.mock('@/components/settings/navigation', () => ({
  getOrganizationSettingsFeatures: vi.fn(() => ({})),
  isOrganizationSettingsSectionAvailable: mockIsOrganizationSettingsSectionAvailable,
  resolveWorkspaceNavigation: mockResolveWorkspaceNavigation,
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/billing', () => ({
  isOrganizationOnEnterprisePlan: mockIsOrganizationOnEnterprisePlan,
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  hasWorkspaceInboxAccess: mockHasWorkspaceInboxAccess,
  hasWorkspaceSandboxAccess: mockHasWorkspaceSandboxAccess,
}))

vi.mock('@/lib/core/config/env', () => ({
  env: {},
  getEnv: vi.fn(),
  isTruthy: vi.fn(() => false),
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  isAppConfigEnabled: false,
  isBillingEnabled: true,
  isHosted: true,
}))

vi.mock('@/lib/organizations/settings-access', () => ({
  canOpenOrganizationSettingsSection: mockCanOpenOrganizationSettingsSection,
}))

vi.mock('@/lib/permissions/super-user', () => ({
  isPlatformAdmin: vi.fn(() => false),
}))

vi.mock('@/lib/workspaces/host-context', () => ({
  getWorkspaceHostContextForViewer: mockGetWorkspaceHostContext,
}))

vi.mock('@/app/_shell/providers/get-query-client', () => ({
  getQueryClient: vi.fn(),
}))

vi.mock('@/app/workspace/[workspaceId]/settings/navigation', () => ({
  allNavigationItems: [{ id: 'general' }, { id: 'billing' }, { id: 'secrets' }, { id: 'sessions' }],
  getSettingsSectionMeta: vi.fn(() => null),
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  resolveWorkspaceGroup: mockResolveWorkspaceGroup,
}))

vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => ({
  isForkingAvailableForWorkspace: mockIsForkingAvailable,
}))

vi.mock('@/app/workspace/[workspaceId]/settings/[section]/prefetch', () => ({
  prefetchGeneralSettings: vi.fn(),
}))

vi.mock('@/app/workspace/[workspaceId]/settings/[section]/settings', () => ({
  SettingsPage: vi.fn(() => null),
}))

import WorkspaceSettingsSectionPage from '@/app/workspace/[workspaceId]/settings/[section]/page'

const PERSONAL_HOST_CONTEXT = {
  workspace: {
    id: 'workspace-b',
    billedAccountUserId: 'owner-b',
  },
  hostOrganizationId: null,
  ownerBilling: {
    isEnterprise: false,
  },
  viewer: {
    permission: 'admin',
    isHostOrganizationAdmin: false,
  },
}

function pageProps(section: string) {
  return {
    params: Promise.resolve({ workspaceId: 'workspace-b', section }),
  }
}

describe('WorkspaceSettingsSectionPage unavailable sections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'viewer-a' } })
    mockGetWorkspaceHostContext.mockResolvedValue(PERSONAL_HOST_CONTEXT)
    mockResolveWorkspaceNavigation.mockReturnValue([])
    mockResolveWorkspaceGroup.mockResolvedValue(null)
    mockIsForkingAvailable.mockResolvedValue(false)
    mockHasWorkspaceInboxAccess.mockResolvedValue(false)
    mockHasWorkspaceSandboxAccess.mockResolvedValue(false)
    mockCanOpenOrganizationSettingsSection.mockResolvedValue(false)
    mockIsOrganizationOnEnterprisePlan.mockResolvedValue(false)
    mockIsOrganizationSettingsSectionAvailable.mockReturnValue(true)
  })

  it('redirects an unavailable subscription section to General', async () => {
    await expect(WorkspaceSettingsSectionPage(pageProps('billing'))).rejects.toThrow(
      'NEXT_REDIRECT:/workspace/workspace-b/settings/general'
    )
  })

  it('redirects a workspace section hidden in the destination workspace to General', async () => {
    await expect(WorkspaceSettingsSectionPage(pageProps('secrets'))).rejects.toThrow(
      'NEXT_REDIRECT:/workspace/workspace-b/settings/general'
    )
  })

  it('redirects an organization section when the destination has no organization', async () => {
    await expect(WorkspaceSettingsSectionPage(pageProps('sessions'))).rejects.toThrow(
      'NEXT_REDIRECT:/workspace/workspace-b/settings/general'
    )
  })

  it('keeps unknown settings sections fail-fast', async () => {
    await expect(WorkspaceSettingsSectionPage(pageProps('unknown'))).rejects.toThrow(
      'NEXT_NOT_FOUND'
    )
    expect(mockGetWorkspaceHostContext).not.toHaveBeenCalled()
  })

  it('keeps inaccessible workspaces fail-fast', async () => {
    mockGetWorkspaceHostContext.mockResolvedValue(null)

    await expect(WorkspaceSettingsSectionPage(pageProps('general'))).rejects.toThrow(
      'NEXT_NOT_FOUND'
    )
  })
})
