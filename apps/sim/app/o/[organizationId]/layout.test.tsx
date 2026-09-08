/**
 * @vitest-environment node
 */

import type { ReactNode } from 'react'
import { authMockFns } from '@sim/testing'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetOrganizationSurfaceContext, mockWorkspaceChrome, mockPrefetchUserProfile } =
  vi.hoisted(() => ({
    mockGetOrganizationSurfaceContext: vi.fn(),
    mockWorkspaceChrome: vi.fn(({ children }: { children: ReactNode }) => children),
    mockPrefetchUserProfile: vi.fn(async () => undefined),
  }))

vi.mock('@tanstack/react-query', () => ({
  HydrationBoundary: ({ children }: { children: ReactNode }) => children,
  dehydrate: () => ({}),
}))

vi.mock('@/app/_shell/providers/get-query-client', () => ({
  getQueryClient: () => ({}),
}))

vi.mock('@/lib/users/prefetch-user-profile', () => ({
  prefetchUserProfile: mockPrefetchUserProfile,
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(() => ({ value: '1' })) })),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

vi.mock('@/lib/organizations/surface', () => ({
  getOrganizationSurfaceContext: mockGetOrganizationSurfaceContext,
}))

vi.mock('@/app/o/[organizationId]/components/organization-sidebar', () => ({
  OrganizationSidebar: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/components/workspace-chrome', () => ({
  WorkspaceChrome: mockWorkspaceChrome,
}))

vi.mock('@/app/workspace/[workspaceId]/providers/global-commands-provider', () => ({
  GlobalCommandsProvider: ({ children }: { children: ReactNode }) => children,
}))

import OrganizationLayout from '@/app/o/[organizationId]/layout'

const mockGetSession = authMockFns.mockGetSession

const SURFACE_CONTEXT = {
  organization: { id: 'org-1', name: 'Acme', slug: 'acme', logo: null, memberCount: 1 },
  viewer: { role: 'member', isAdmin: false },
}

describe('OrganizationLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'viewer-1' } })
  })

  it('renders the surface for a member and seeds the chrome from the collapse cookie', async () => {
    mockGetOrganizationSurfaceContext.mockResolvedValue(SURFACE_CONTEXT)

    const element = await OrganizationLayout({
      children: <div>Organization child</div>,
      params: Promise.resolve({ organizationId: 'org-1' }),
    })
    const html = renderToStaticMarkup(element)

    expect(mockGetOrganizationSurfaceContext).toHaveBeenCalledWith('org-1', 'viewer-1')
    expect(mockPrefetchUserProfile).toHaveBeenCalledWith({}, 'viewer-1')
    expect(html).toContain('Organization child')
    expect(mockWorkspaceChrome).toHaveBeenCalledWith(
      expect.objectContaining({ initialSidebarCollapsed: true }),
      undefined
    )
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
  })
})
