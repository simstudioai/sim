/**
 * @vitest-environment node
 */
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockBrandingProvider,
  mockGetOrgWhitelabelSettings,
  mockGetSession,
  mockPrefetchWorkspaceHostContext,
  mockPrefetchWorkspaceSidebar,
} = vi.hoisted(() => ({
  mockBrandingProvider: vi.fn(({ children }: { children: ReactNode }) => children),
  mockGetOrgWhitelabelSettings: vi.fn(),
  mockGetSession: vi.fn(),
  mockPrefetchWorkspaceHostContext: vi.fn(),
  mockPrefetchWorkspaceSidebar: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({
  ToastProvider: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@tanstack/react-query', () => ({
  dehydrate: vi.fn(() => ({})),
  HydrationBoundary: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(() => undefined) })),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/app/_shell/providers/get-query-client', () => ({
  getQueryClient: () => ({ setQueryData: vi.fn() }),
}))

vi.mock('@/app/workspace/[workspaceId]/prefetch', () => ({
  prefetchWorkspaceHostContext: mockPrefetchWorkspaceHostContext,
  prefetchWorkspaceSidebar: mockPrefetchWorkspaceSidebar,
}))

vi.mock('@/ee/whitelabeling/org-branding', () => ({
  getOrgWhitelabelSettings: mockGetOrgWhitelabelSettings,
}))

vi.mock('@/ee/whitelabeling/components/branding-provider', () => ({
  BrandingProvider: mockBrandingProvider,
}))

vi.mock('@/app/workspace/[workspaceId]/components/impersonation-banner', () => ({
  ImpersonationBanner: () => null,
  ImpersonationExpired: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/components/workspace-chrome', () => ({
  WorkspaceChrome: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@/app/workspace/[workspaceId]/components/workspace-access-denied', () => ({
  WorkspaceAccessDenied: () => <div>Workspace access denied</div>,
}))

vi.mock('@/app/workspace/[workspaceId]/providers/custom-blocks-loader', () => ({
  CustomBlocksLoader: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/providers/block-visibility-loader', () => ({
  BlockVisibilityLoader: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/providers/global-commands-provider', () => ({
  GlobalCommandsProvider: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@/app/workspace/[workspaceId]/providers/provider-models-loader', () => ({
  ProviderModelsLoader: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/providers/settings-loader', () => ({
  SettingsLoader: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  WorkspaceHostProvider: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  WorkspacePermissionsProvider: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-scope-sync', () => ({
  WorkspaceScopeSync: () => null,
}))

import WorkspaceLayout from '@/app/workspace/[workspaceId]/layout'

const HOST_CONTEXT = {
  workspace: {
    id: 'workspace-b',
    name: 'Workspace B',
    workspaceMode: 'organization',
    billedAccountUserId: 'owner-b',
  },
  hostOrganizationId: 'org-b',
  ownerBilling: {
    plan: 'enterprise',
    status: 'active',
    isPaid: true,
    isPro: false,
    isTeam: false,
    isEnterprise: true,
    isOrgScoped: true,
    organizationId: 'org-b',
    billingInterval: 'month',
    billingBlocked: false,
    billingBlockedReason: null,
  },
  viewer: {
    permission: 'read',
    isHostOrganizationMember: false,
    isHostOrganizationAdmin: false,
  },
} as const

describe('WorkspaceLayout host context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({
      user: { id: 'viewer-1' },
      session: { activeOrganizationId: 'org-a' },
    })
    mockPrefetchWorkspaceHostContext.mockResolvedValue(HOST_CONTEXT)
    mockPrefetchWorkspaceSidebar.mockResolvedValue(undefined)
    mockGetOrgWhitelabelSettings.mockResolvedValue({ brandName: 'Host B' })
  })

  it('hydrates branding from routed workspace B instead of viewer organization A', async () => {
    const element = await WorkspaceLayout({
      children: <div>Workspace child</div>,
      params: Promise.resolve({ workspaceId: 'workspace-b' }),
    })
    renderToStaticMarkup(element)

    expect(mockGetOrgWhitelabelSettings).toHaveBeenCalledWith('org-b')
    expect(mockGetOrgWhitelabelSettings).not.toHaveBeenCalledWith('org-a')
    expect(mockPrefetchWorkspaceSidebar).toHaveBeenCalledWith(
      expect.anything(),
      'workspace-b',
      'viewer-1',
      HOST_CONTEXT,
      'org-a'
    )
    expect(mockBrandingProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        hostOrganizationId: 'org-b',
        viewerIsHostOrganizationMember: false,
        initialOrgSettings: { brandName: 'Host B' },
      }),
      undefined
    )
  })

  it('renders an explicit denial without loading workspace data or branding', async () => {
    mockPrefetchWorkspaceHostContext.mockResolvedValue(null)

    const element = await WorkspaceLayout({
      children: <div>Secret workspace child</div>,
      params: Promise.resolve({ workspaceId: 'workspace-denied' }),
    })
    const html = renderToStaticMarkup(element)

    expect(html).toContain('Workspace access denied')
    expect(html).not.toContain('Secret workspace child')
    expect(mockPrefetchWorkspaceSidebar).not.toHaveBeenCalled()
    expect(mockGetOrgWhitelabelSettings).not.toHaveBeenCalled()
  })
})
