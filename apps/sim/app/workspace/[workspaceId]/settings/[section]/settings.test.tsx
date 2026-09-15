/**
 * @vitest-environment jsdom
 */
import { act, type ComponentType, lazy, type ReactNode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

vi.mock('next/dynamic', () => ({
  default: (load: () => Promise<ComponentType>) => lazy(async () => ({ default: await load() })),
}))
vi.mock('posthog-js/react', () => ({ usePostHog: () => null }))
vi.mock('@/lib/posthog/client', () => ({ captureEvent: vi.fn() }))
vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'viewer-1', role: 'user' } }, isPending: false }),
}))
vi.mock('@/lib/core/config/deployment-shape', () => ({
  useDeploymentShape: () => ({ billingEnabled: false }),
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useWorkspaceHostContext: () => ({
    hostOrganizationId: 'organization-1',
    workspace: { id: 'workspace-1' },
  }),
}))
vi.mock('@/app/workspace/[workspaceId]/settings/components/general/general', () => ({
  General: () => <div>General settings</div>,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/team-management/team-management',
  () => ({
    TeamManagement: ({ organizationId }: { organizationId: string }) => (
      <div>Members of {organizationId}</div>
    ),
  })
)
vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsSectionProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/app/workspace/[workspaceId]/settings/navigation', () => ({
  getSettingsSectionMeta: () => null,
}))

import { SettingsPage } from '@/app/workspace/[workspaceId]/settings/[section]/settings'

it('renders the inline member roster with billing disabled, while billing stays unavailable', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => {
      root.render(
        <Suspense>
          <SettingsPage section='organization' />
        </Suspense>
      )
    })
    expect(container).toHaveTextContent('Members of organization-1')
    expect(container).not.toHaveTextContent('General settings')

    await act(async () => root.render(<SettingsPage section='billing' />))
    expect(container).toHaveTextContent('General settings')
  } finally {
    act(() => root.unmount())
  }
})
