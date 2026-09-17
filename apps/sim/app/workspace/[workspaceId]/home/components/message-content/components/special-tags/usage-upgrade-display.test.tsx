/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

const { usageGate } = vi.hoisted(() => ({ usageGate: vi.fn() }))
vi.mock('@/hooks/queries/workspace-usage', () => ({ useWorkspaceUsageGate: usageGate }))
vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'member' } } }),
}))
vi.mock('@/lib/core/config/deployment-shape', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/config/deployment-shape')>()),
  useDeploymentShape: () => ({ hosted: true }),
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useOptionalWorkspaceHostContext: () => ({
    workspace: { id: 'workspace', billedAccountUserId: 'owner' },
    hostOrganizationId: 'organization',
    viewer: { isHostOrganizationAdmin: false },
  }),
}))
vi.mock('@/hooks/use-settings-navigation', () => ({
  useSettingsNavigation: () => ({ getSettingsHref: () => '/settings/billing' }),
}))
vi.mock('@/ee/access-requests/components/member-limit-request-action', () => ({
  MemberLimitRequestAction: () => <button type='button'>Request increase</button>,
}))

import { SpecialTags } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags'

describe('usage-limit request action', () => {
  it.each([
    { scope: 'payer', isExceeded: true, isSuccess: true, visible: false },
    { scope: 'member', isExceeded: true, isSuccess: true, visible: true },
    { scope: 'member', isExceeded: false, isSuccess: true, visible: false },
    { scope: 'member', isExceeded: true, isSuccess: false, visible: false },
  ])(
    'offers the remedy for the current cap ($scope, exceeded $isExceeded, loaded $isSuccess)',
    ({ scope, isExceeded, isSuccess, visible }) => {
      usageGate.mockReturnValue({ isSuccess, data: { scope, isExceeded } })
      ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
      const container = document.createElement('div')
      const root = createRoot(container)
      try {
        act(() =>
          root.render(
            <SpecialTags
              segment={{
                type: 'usage_upgrade',
                data: {
                  action: 'increase_limit',
                  reason: 'usage_limit',
                  message: 'Usage limit reached',
                },
              }}
            />
          )
        )
        expect(container.textContent?.includes('Request increase')).toBe(visible)
      } finally {
        act(() => root.unmount())
      }
    }
  )
})
