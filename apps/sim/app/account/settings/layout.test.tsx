import type { ReactNode } from 'react'
import { authMockFns } from '@sim/testing'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/permissions/super-user', () => ({ isPlatformAdmin: vi.fn(async () => false) }))
vi.mock('@/components/settings/standalone-settings-shell', () => ({
  StandaloneSettingsShell: ({ children }: { children: ReactNode }) => children,
}))

import AccountSettingsLayout from '@/app/account/settings/layout'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'

/** Stands in for the personal API keys page, whose create modal reads this flag on every render. */
function ReadOnlyKeysFlag() {
  return <span>{`read-only keys ${useFeatureFlag('api-key-read-only') ? 'on' : 'off'}`}</span>
}

async function renderAccountSettings(): Promise<string> {
  const element = await AccountSettingsLayout({ children: <ReadOnlyKeysFlag /> })
  return renderToStaticMarkup(element)
}

describe('AccountSettingsLayout', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'viewer-1' },
      session: { id: 'session-1' },
    })
  })

  it.each([
    [true, 'on'],
    [false, 'off'],
  ])('gives account sections the read-only key flag (%s)', async (enabled, rendered) => {
    featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
      async (flag) => flag === 'api-key-read-only' && enabled
    )
    expect(await renderAccountSettings()).toContain(`read-only keys ${rendered}`)
  })
})
