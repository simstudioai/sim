import type { ReactNode } from 'react'
import { authMockFns } from '@sim/testing'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { reactQueryMock } from '@sim/testing/mocks/react-query.mock'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetOrganizationSurfaceContext,
  mockWorkspaceChrome,
  mockPrefetchOrganizationSidebar,
  mockUseMothershipChatEvents,
} = vi.hoisted(() => ({
  mockGetOrganizationSurfaceContext: vi.fn(),
  mockWorkspaceChrome: vi.fn(({ children }: { children: ReactNode }) => children),
  mockPrefetchOrganizationSidebar: vi.fn(async () => undefined),
  mockUseMothershipChatEvents: vi.fn(),
}))

vi.mock('@/app/workspace/providers/socket-provider', () => ({
  SocketProvider: ({ children }: { children: import('react').ReactNode }) => children,
}))
vi.mock('@/hooks/use-mothership-chat-events', () => ({
  useMothershipChatEvents: mockUseMothershipChatEvents,
}))

vi.mock('@/lib/auth/client', () => authClientMock)
vi.mock('@/hooks/queries/admin-users', () => ({
  useStopImpersonating: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/stores', () => ({ clearUserData: vi.fn() }))
vi.mock('@/lib/auth/stale-session-recovery', () => ({
  recoverFromStaleSession: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => reactQueryMock)

vi.mock('@/hooks/queries/utils/get-query-client', () => ({
  getQueryClient: () => ({}),
}))

vi.mock('@/app/o/[organizationId]/prefetch', () => ({
  prefetchOrganizationSidebar: mockPrefetchOrganizationSidebar,
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(() => ({ value: '1' })) })),
}))

vi.mock('next/navigation', () => nextNavigationMock)

vi.mock('@/lib/organizations/surface', () => ({
  getOrganizationSurfaceContext: mockGetOrganizationSurfaceContext,
}))

vi.mock('@/platform/embedded/app/(shell)/_components/sidebar/sidebar', () => ({
  Sidebar: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/components/workspace-chrome', () => ({
  WorkspaceChrome: mockWorkspaceChrome,
  WorkspaceViewport: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@/lib/global-commands/provider', () => ({
  GlobalCommandsProvider: ({ children }: { children: ReactNode }) => children,
}))

import OrganizationLayout from '@/app/o/[organizationId]/layout'

const mockGetSession = authMockFns.mockGetSession
const mockUseSession = authClientMockFns.mockUseSession

describe('OrganizationLayout', () => {
  beforeEach(() => {
    mockGetSession.mockResolvedValue({
      user: { id: 'viewer-1' },
      session: { id: 'session-1', activeOrganizationId: 'active-org' },
    })
    mockUseSession.mockReturnValue({ data: { user: { id: 'viewer-1' } }, isPending: false })
  })

  it('renders an explicit denial for a non-member without the surface', async () => {
    mockGetOrganizationSurfaceContext.mockResolvedValue(null)

    const element = await OrganizationLayout({
      children: <div>Secret organization child</div>,
      params: Promise.resolve({ organizationId: 'org-denied' }),
    })
    const html = renderToStaticMarkup(element)

    expect(html).toContain('Organization access denied')
    expect(html).not.toContain('Secret organization child')
    expect(mockWorkspaceChrome).not.toHaveBeenCalled()
    expect(mockPrefetchOrganizationSidebar).not.toHaveBeenCalled()
  })
})
