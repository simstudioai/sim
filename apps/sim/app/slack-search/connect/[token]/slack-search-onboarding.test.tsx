/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ status: vi.fn(), redirect: vi.fn() }))
vi.mock('@/hooks/queries/slack-search-onboarding', () => ({
  useSlackSearchOnboarding: mocks.status,
}))
vi.mock('@/hooks/queries/oauth-provider', () => ({ useOAuthSwitchAccount: () => ({}) }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))

import { SlackSearchOnboarding } from '@/app/slack-search/connect/[token]/slack-search-onboarding'

describe('Slack source setup destination', () => {
  it.each(['needs_sources', 'ready', 'retried'])(
    'uses the existing integrations page for %s',
    (status) => {
      mocks.status.mockReturnValue({ data: { status, organizationId: 'organization-a' } })
      SlackSearchOnboarding({ token: 'opaque-context', userId: 'viewer' })
      expect(mocks.redirect).toHaveBeenLastCalledWith(
        '/o/organization-a/integrations?slack=opaque-context'
      )
    }
  )
})
