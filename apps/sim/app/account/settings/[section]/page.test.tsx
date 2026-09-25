import { createRouteContext } from '@sim/testing/helpers/http'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrefetch } = vi.hoisted(() => ({
  mockPrefetch: vi.fn(),
}))

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/permissions/super-user', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@/app/_shell/providers/get-query-client', () => ({ getQueryClient: vi.fn() }))
vi.mock('@/components/settings/prefetch-standalone-general', () => ({
  prefetchStandaloneGeneral: mockPrefetch,
}))
vi.mock('@/components/settings/account-settings-renderer', () => ({
  AccountSettingsRenderer: () => null,
}))

import AccountSettingsSectionPage from '@/app/account/settings/[section]/page'

setEnvFlags({ isBillingEnabled: true })

const mockGetSession = authMockFns.mockGetSession

const pageProps = (section: string) => createRouteContext({ section })

describe('account settings legacy links', () => {
  beforeEach(() => {
    mockGetSession.mockResolvedValue({ user: { id: 'viewer-a' } })
  })

  it('authenticates before following the legacy bookmark', async () => {
    mockGetSession.mockResolvedValue(null)

    await expect(AccountSettingsSectionPage(pageProps('authorized-apps'))).rejects.toThrow(
      'NEXT_REDIRECT:/login'
    )
  })

  it.each(['unknown', 'connected-accounts'])(
    'rejects unavailable sections: %s',
    async (section) => {
      await expect(AccountSettingsSectionPage(pageProps(section))).rejects.toThrow('NEXT_NOT_FOUND')
    }
  )
})
