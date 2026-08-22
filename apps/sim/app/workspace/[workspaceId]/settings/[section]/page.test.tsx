/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCanOpenOrganizationSettingsSection,
  mockGetSession,
  mockGetWorkspaceHostContext,
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
  workspaceSectionUsesPermissionConfig: vi.fn((section: string) =>
    ['secrets', 'api-keys', 'inbox', 'mcp', 'custom-tools'].includes(section)
  ),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/billing', () => ({
  isOrganizationOnEnterprisePlan: mockIsOrganizationOnEnterprisePlan,
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
  getQueryClient: mockGetQueryClient,
}))

const { mockGetQueryClient, mockPrefetchGeneralSettings } = vi.hoisted(() => ({
  mockGetQueryClient: vi.fn(),
  mockPrefetchGeneralSettings: vi.fn(),
}))

const { mockSections, mockAliases } = vi.hoisted(() => ({
  mockSections: ['general', 'billing', 'secrets', 'sessions', 'admin', 'teammates'],
  /** Mirrors the real alias table so a legacy segment behaves here as it does in production. */
  mockAliases: {
    subscription: 'billing',
    team: 'organization',
    'api-keys': 'apikeys',
    domains: 'sso',
  } as Record<string, string>,
}))

vi.mock('@/app/workspace/[workspaceId]/settings/navigation', () => ({
  resolveSettingsSection: vi.fn((section: string) => {
    const id = mockAliases[section] ?? section
    return mockSections.includes(id) ? { id, meta: { title: id } } : null
  }),
  getSettingsSectionMeta: vi.fn(() => null),
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  resolveWorkspaceGroup: mockResolveWorkspaceGroup,
}))

vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => ({
  isForkingAvailableForWorkspace: mockIsForkingAvailable,
}))

vi.mock('@/app/workspace/[workspaceId]/settings/[section]/prefetch', () => ({
  prefetchGeneralSettings: mockPrefetchGeneralSettings,
}))

vi.mock('@/app/workspace/[workspaceId]/settings/[section]/settings', () => ({
  SettingsPage: vi.fn(() => null),
}))

import { QueryClient } from '@tanstack/react-query'
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

const ORGANIZATION_HOST_CONTEXT = {
  workspace: {
    id: 'workspace-b',
    billedAccountUserId: 'owner-b',
  },
  hostOrganizationId: 'organization-b',
  ownerBilling: {
    isEnterprise: true,
  },
  viewer: {
    permission: 'admin',
    isHostOrganizationAdmin: true,
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
    mockCanOpenOrganizationSettingsSection.mockResolvedValue(false)
    mockIsOrganizationOnEnterprisePlan.mockResolvedValue(false)
    mockIsOrganizationSettingsSectionAvailable.mockReturnValue(true)
    mockGetQueryClient.mockReturnValue(new QueryClient())
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

  it('hydrates general settings only for the sections whose body reads them', async () => {
    // The saving this gate exists for: the other ~25 sections no longer block on a query they
    // never touch. `general` still does, and so does an alias that resolves onto the set.
    mockResolveWorkspaceNavigation.mockReturnValue([{ id: 'secrets' }])

    await WorkspaceSettingsSectionPage(pageProps('general'))
    expect(mockPrefetchGeneralSettings).toHaveBeenCalledTimes(1)

    mockPrefetchGeneralSettings.mockClear()
    await WorkspaceSettingsSectionPage(pageProps('secrets'))
    expect(mockPrefetchGeneralSettings).not.toHaveBeenCalled()
  })

  it('resolves a permission group only when its config can hide the requested section', async () => {
    mockGetWorkspaceHostContext.mockResolvedValue(ORGANIZATION_HOST_CONTEXT)
    mockResolveWorkspaceNavigation.mockReturnValue([{ id: 'teammates' }])

    await WorkspaceSettingsSectionPage(pageProps('teammates'))

    expect(mockResolveWorkspaceGroup).not.toHaveBeenCalled()

    mockResolveWorkspaceNavigation.mockReturnValue([{ id: 'secrets' }])
    await WorkspaceSettingsSectionPage(pageProps('secrets'))

    expect(mockResolveWorkspaceGroup).toHaveBeenCalledTimes(1)
    expect(mockResolveWorkspaceGroup).toHaveBeenCalledWith(
      'viewer-a',
      'organization-b',
      'workspace-b'
    )
  })

  it('overlaps general-settings hydration with the organization section gate', async () => {
    let resolveCanOpenSection: ((value: boolean) => void) | undefined
    mockGetWorkspaceHostContext.mockResolvedValue(ORGANIZATION_HOST_CONTEXT)
    mockCanOpenOrganizationSettingsSection.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveCanOpenSection = resolve
      })
    )

    const render = WorkspaceSettingsSectionPage(pageProps('billing'))
    await vi.waitFor(() => expect(mockCanOpenOrganizationSettingsSection).toHaveBeenCalledTimes(1))

    expect(mockPrefetchGeneralSettings).toHaveBeenCalledWith(expect.any(QueryClient), 'viewer-a')

    resolveCanOpenSection?.(true)
    await render
  })

  it('gates the hydration on the resolved section, not the raw segment', async () => {
    // `/settings/subscription` is a legacy link for billing, which does read the key. Billing on
    // a personal workspace is only reachable by the billed account owner.
    mockGetSession.mockResolvedValue({ user: { id: 'owner-b' } })

    await WorkspaceSettingsSectionPage(pageProps('subscription'))

    expect(mockPrefetchGeneralSettings).toHaveBeenCalledTimes(1)
  })

  it('keeps inaccessible workspaces fail-fast', async () => {
    mockGetWorkspaceHostContext.mockResolvedValue(null)

    await expect(WorkspaceSettingsSectionPage(pageProps('general'))).rejects.toThrow(
      'NEXT_NOT_FOUND'
    )
    expect(mockPrefetchGeneralSettings).not.toHaveBeenCalled()
  })
})
