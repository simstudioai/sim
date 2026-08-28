/**
 * @vitest-environment node
 *
 * Deployment-dependent settings routing, pinned on the hosted side. Separate from
 * `navigation.test.ts` because the catalog it asserts against is a module-scope
 * constant, so `isHosted` has to differ per file rather than per test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env-flags', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  isHosted: true,
}))

import { resolveWorkspaceNavigation } from '@/components/settings/navigation'
import {
  allNavigationItems,
  resolveSettingsSection,
} from '@/app/workspace/[workspaceId]/settings/navigation'

const ENTITLEMENTS = {
  byok: true,
  credentialGroups: true,
  inbox: true,
  customBlocks: true,
  forks: true,
  sandboxes: true,
} as const

describe('self-host section on a hosted deployment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * A 404 renders from Next's `__next_error__` document, where no
   * `NEXT_PUBLIC_*` constant is readable — so the segment must resolve.
   */
  it('resolves the segment so the page gate can redirect instead of 404ing', () => {
    expect(resolveSettingsSection('self-host')).toEqual({
      id: 'self-host',
      meta: {
        title: 'Self hosting',
        description: 'Manage this deployment from the Sim managed service.',
        docsLink: undefined,
      },
    })
  })

  it('keeps the section in the catalog, since availability is not the route’s call', () => {
    expect(allNavigationItems.some(({ id }) => id === 'self-host')).toBe(true)
  })

  it('excludes the section from workspace navigation, which is what triggers the redirect', () => {
    const navigation = resolveWorkspaceNavigation({
      permission: 'admin',
      permissionConfig: {},
      entitlements: { ...ENTITLEMENTS },
    })

    expect(navigation.some(({ id }) => id === 'self-host')).toBe(false)
  })

  it('leaves a genuinely unknown segment unresolved, so it still 404s', () => {
    expect(resolveSettingsSection('not-a-section')).toBeNull()
  })
})
