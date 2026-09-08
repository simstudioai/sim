/**
 * @vitest-environment node
 */
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthorizeSection,
  mockGetQueryClient,
  mockGetSession,
  mockNotFound,
  mockRedirect,
  mockSectionPrefetch,
  mockGetHostContext,
} = vi.hoisted(() => ({
  mockAuthorizeSection: vi.fn(),
  mockGetQueryClient: vi.fn(),
  mockGetSession: vi.fn(),
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  mockRedirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`)
  }),
  mockSectionPrefetch: vi.fn(),
  mockGetHostContext: vi.fn(),
}))

vi.mock('next/navigation', () => ({ notFound: mockNotFound, redirect: mockRedirect }))
vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/settings/application/workspace-section-access', () => ({
  authorizeWorkspaceSettingsSection: mockAuthorizeSection,
}))
vi.mock('@/lib/workspaces/host-context', () => ({
  getWorkspaceHostContextForViewer: mockGetHostContext,
}))
vi.mock('@/app/_shell/providers/get-query-client', () => ({
  getQueryClient: mockGetQueryClient,
}))
vi.mock('@/app/workspace/[workspaceId]/settings/navigation', () => ({
  resolveSettingsSection: vi.fn((section: string) => {
    const aliases: Record<string, string> = { subscription: 'billing' }
    const id = aliases[section] ?? section
    return ['general', 'billing', 'secrets'].includes(id) ? { id, meta: { title: id } } : null
  }),
}))
vi.mock('@/app/workspace/[workspaceId]/settings/[section]/prefetch', () => ({
  SECTION_PREFETCHERS: { general: mockSectionPrefetch, billing: mockSectionPrefetch },
}))
vi.mock('@/app/workspace/[workspaceId]/settings/[section]/settings', () => ({
  SettingsPage: vi.fn(() => null),
}))

import WorkspaceSettingsSectionPage from '@/app/workspace/[workspaceId]/settings/[section]/page'

function pageProps(section: string) {
  return { params: Promise.resolve({ workspaceId: 'workspace-b', section }) }
}

describe('WorkspaceSettingsSectionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'viewer-a' } })
    mockAuthorizeSection.mockResolvedValue({ allowed: true })
    mockGetQueryClient.mockReturnValue(new QueryClient())
    mockSectionPrefetch.mockResolvedValue(undefined)
    mockGetHostContext.mockResolvedValue(null)
  })

  it('authenticates before authorizing the resolved section', async () => {
    await WorkspaceSettingsSectionPage(pageProps('subscription'))

    expect(mockAuthorizeSection).toHaveBeenCalledWith({
      workspaceId: 'workspace-b',
      userId: 'viewer-a',
      section: 'billing',
    })
    expect(mockSectionPrefetch).toHaveBeenCalledTimes(1)
  })

  it('preserves legacy organization settings query state on the canonical org destination', async () => {
    mockGetHostContext.mockResolvedValue({ hostOrganizationId: 'org-target' })
    await expect(
      WorkspaceSettingsSectionPage({
        ...pageProps('subscription'),
        searchParams: Promise.resolve({ window: 'month', source: ['search', 'chat'] }),
      })
    ).rejects.toThrow(
      'NEXT_REDIRECT:/o/org-target/settings/billing?window=month&source=search&source=chat'
    )
    expect(mockSectionPrefetch).not.toHaveBeenCalled()
  })

  it('conceals inaccessible workspaces and platform-only sections', async () => {
    mockAuthorizeSection.mockResolvedValue({ allowed: false, disposition: 'not-found' })

    await expect(WorkspaceSettingsSectionPage(pageProps('general'))).rejects.toThrow(
      'NEXT_NOT_FOUND'
    )
    expect(mockSectionPrefetch).not.toHaveBeenCalled()
  })

  it('redirects unavailable visible-catalog sections to General', async () => {
    mockAuthorizeSection.mockResolvedValue({ allowed: false, disposition: 'redirect-general' })

    await expect(WorkspaceSettingsSectionPage(pageProps('billing'))).rejects.toThrow(
      'NEXT_REDIRECT:/workspace/workspace-b/settings/general'
    )
    expect(mockSectionPrefetch).not.toHaveBeenCalled()
  })

  it('rejects unknown sections before protected authorization', async () => {
    await expect(WorkspaceSettingsSectionPage(pageProps('unknown'))).rejects.toThrow(
      'NEXT_NOT_FOUND'
    )
    expect(mockAuthorizeSection).not.toHaveBeenCalled()
  })

  it('prefetches only sections with an explicit prefetcher after authorization', async () => {
    await WorkspaceSettingsSectionPage(pageProps('secrets'))
    expect(mockSectionPrefetch).not.toHaveBeenCalled()

    await WorkspaceSettingsSectionPage(pageProps('general'))
    expect(mockSectionPrefetch).toHaveBeenCalledTimes(1)
  })

  it('redirects unauthenticated viewers without authorizing', async () => {
    mockGetSession.mockResolvedValue(null)

    await expect(WorkspaceSettingsSectionPage(pageProps('general'))).rejects.toThrow(
      'NEXT_REDIRECT:/login'
    )
    expect(mockAuthorizeSection).not.toHaveBeenCalled()
  })
})
