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

import { useFeatureFlag } from '@/lib/core/config/feature-flags-context'
import AccountSettingsLayout from '@/app/(site)/account/settings/layout'

/**
 * Renders the account layout around a section that reads the read-only key flag the way the
 * personal API keys page's create modal does on every render, and returns what it read.
 */
async function readFlagInAccountSettings(): Promise<boolean> {
  let observed: boolean | undefined
  function ReadOnlyKeysSection() {
    observed = useFeatureFlag('api-key-read-only')
    return null
  }
  renderToStaticMarkup(await AccountSettingsLayout({ children: <ReadOnlyKeysSection /> }))
  if (observed === undefined) throw new Error('The account section never rendered')
  return observed
}

describe('AccountSettingsLayout', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'viewer-1' },
      session: { id: 'session-1' },
    })
  })

  it.each([true, false])('gives account sections the read-only key flag (%s)', async (enabled) => {
    featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
      async (flag) => flag === 'api-key-read-only' && enabled
    )
    expect(await readFlagInAccountSettings()).toBe(enabled)
  })
})
