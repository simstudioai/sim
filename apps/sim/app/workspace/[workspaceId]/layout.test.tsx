import type { ReactNode } from 'react'
import { authMockFns } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { emcnMock } from '@sim/testing/mocks/emcn.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { reactQueryMock } from '@sim/testing/mocks/react-query.mock'
import { renderToReadableStream } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockHasSignedInDesktopExecutor,
  mockWorkspaceChrome,
  mockPrefetchWorkspaceHostContext,
  mockPrefetchWorkspaceSidebar,
  mockPrefetchWorkspaceAccess,
  mockPrefetchWorkspaceForkAvailability,
} = vi.hoisted(() => ({
  mockHasSignedInDesktopExecutor: vi.fn(async () => false),
  mockWorkspaceChrome: vi.fn(
    ({ children }: { children: ReactNode; sidebar: ReactNode }) => children
  ),
  mockPrefetchWorkspaceHostContext: vi.fn(),
  mockPrefetchWorkspaceSidebar: vi.fn(),
  mockPrefetchWorkspaceAccess: vi.fn(),
  mockPrefetchWorkspaceForkAvailability: vi.fn(),
}))

vi.mock('@sim/emcn', () => emcnMock)

vi.mock('@tanstack/react-query', () => reactQueryMock)

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(() => undefined) })),
}))

vi.mock('next/navigation', () => nextNavigationMock)

vi.mock('@/app/_shell/providers/get-query-client', () => ({
  getQueryClient: () => ({ setQueryData: vi.fn() }),
}))

vi.mock('@/app/workspace/[workspaceId]/prefetch', () => ({
  prefetchWorkspaceHostContext: mockPrefetchWorkspaceHostContext,
  prefetchWorkspaceSidebar: mockPrefetchWorkspaceSidebar,
  prefetchWorkspaceForkAvailability: mockPrefetchWorkspaceForkAvailability,
}))

vi.mock('@/app/workspace/[workspaceId]/prefetch-access', () => ({
  prefetchWorkspaceAccess: mockPrefetchWorkspaceAccess,
}))

vi.mock('@/app/_shell/application-loading', () => ({
  ApplicationLoading: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/components/impersonation-banner', () => ({
  ImpersonationBanner: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/components/session-expired', () => ({
  SessionExpired: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/components/workspace-chrome', () => ({
  WorkspaceChrome: mockWorkspaceChrome,
  WorkspaceViewport: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@/lib/desktop/executor/repository', () => ({
  hasSignedInDesktopExecutor: mockHasSignedInDesktopExecutor,
}))

vi.mock('@/app/workspace/[workspaceId]/w/components/sidebar/sidebar', () => ({
  Sidebar: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/components/workspace-access-denied', () => ({
  WorkspaceAccessDenied: () => <div>Workspace access denied</div>,
}))

vi.mock('@/app/workspace/[workspaceId]/providers/desktop-oauth-connect-listener', () => ({
  DesktopOAuthConnectListener: () => null,
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

const mockGetSession = authMockFns.mockGetSession

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
    mockGetSession.mockResolvedValue({
      user: { id: 'viewer-1' },
      session: { id: 'session-1', activeOrganizationId: 'org-a' },
    })
    mockPrefetchWorkspaceHostContext.mockResolvedValue(HOST_CONTEXT)
    mockPrefetchWorkspaceSidebar.mockResolvedValue(undefined)
    mockPrefetchWorkspaceAccess.mockResolvedValue(undefined)
    mockPrefetchWorkspaceForkAvailability.mockResolvedValue(undefined)
  })

  it('loads routed workspace B for a viewer whose active organization is A', async () => {
    const element = await WorkspaceLayout({
      children: <div>Workspace child</div>,
      params: Promise.resolve({ workspaceId: 'workspace-b' }),
    })
    await new Response(await renderToReadableStream(element)).text()

    expect(mockPrefetchWorkspaceSidebar).toHaveBeenCalledWith(
      expect.anything(),
      'workspace-b',
      'viewer-1',
      HOST_CONTEXT,
      'org-a'
    )
    expect(mockPrefetchWorkspaceAccess).toHaveBeenCalledWith(
      expect.anything(),
      'workspace-b',
      createSessionPrincipal({ userId: 'viewer-1' })
    )
  })

  it('renders an explicit denial without loading workspace data', async () => {
    mockPrefetchWorkspaceHostContext.mockResolvedValue(null)

    const element = await WorkspaceLayout({
      children: <div>Secret workspace child</div>,
      params: Promise.resolve({ workspaceId: 'workspace-denied' }),
    })
    const html = await new Response(await renderToReadableStream(element)).text()

    expect(html).toContain('Workspace access denied')
    expect(html).not.toContain('Secret workspace child')
    expect(mockPrefetchWorkspaceSidebar).not.toHaveBeenCalled()
    expect(mockPrefetchWorkspaceAccess).not.toHaveBeenCalled()
  })

  async function sidebarProps() {
    mockWorkspaceChrome.mockClear()
    const element = await WorkspaceLayout({
      children: <div>Workspace child</div>,
      params: Promise.resolve({ workspaceId: 'workspace-b' }),
    })
    await new Response(await renderToReadableStream(element)).text()
    return mockWorkspaceChrome.mock.calls[0][0].sidebar
  }

  it.each([true, false])(
    'tells the sidebar whether the viewer has a desktop that runs their turns (%s)',
    async (registered) => {
      mockHasSignedInDesktopExecutor.mockResolvedValueOnce(registered)

      expect(await sidebarProps()).toMatchObject({
        props: { desktopExecutorRegistered: registered },
      })
    }
  )
})
