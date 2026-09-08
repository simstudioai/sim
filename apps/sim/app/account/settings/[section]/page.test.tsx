/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockPrefetch } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockPrefetch: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`)
  },
}))
vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/core/config/env-flags', () => ({ isBillingEnabled: true }))
vi.mock('@/lib/permissions/super-user', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@/app/_shell/providers/get-query-client', () => ({ getQueryClient: vi.fn() }))
vi.mock('@/components/settings/prefetch-standalone-general', () => ({
  prefetchStandaloneGeneral: mockPrefetch,
}))
vi.mock('@/components/settings/account-settings-renderer', () => ({
  AccountSettingsRenderer: () => null,
}))

import AccountSettingsSectionPage from '@/app/account/settings/[section]/page'

const pageProps = (section: string) => ({ params: Promise.resolve({ section }) })

describe('account settings legacy links', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'viewer-a' } })
  })

  it('redirects Authorized apps bookmarks to the General subview', async () => {
    await expect(AccountSettingsSectionPage(pageProps('authorized-apps'))).rejects.toThrow(
      'NEXT_REDIRECT:/account/settings/general?view=authorized-apps'
    )
    expect(mockPrefetch).not.toHaveBeenCalled()
  })

  it('authenticates before following the legacy bookmark', async () => {
    mockGetSession.mockResolvedValue(null)

    await expect(AccountSettingsSectionPage(pageProps('authorized-apps'))).rejects.toThrow(
      'NEXT_REDIRECT:/login'
    )
  })

  it('still rejects unknown sections', async () => {
    await expect(AccountSettingsSectionPage(pageProps('unknown'))).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
