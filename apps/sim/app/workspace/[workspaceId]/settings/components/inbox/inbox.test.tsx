/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseInboxConfig } = vi.hoisted(() => ({
  mockUseInboxConfig: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
}))

vi.mock('@/components/settings/navigation', () => ({
  canMutateWorkspaceSettingsSection: () => true,
}))

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => ({}),
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/inbox/components', () => ({
  InboxEnableToggle: () => <div>inbox-toggle</div>,
  InboxSettingsTab: () => <div>inbox-settings</div>,
  InboxTaskList: () => <div>inbox-tasks</div>,
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-empty-state', () => ({
  SettingsEmptyState: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
}))

vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section',
  () => ({
    SettingsSection: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
  })
)

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-upgrade-notice', () => ({
  SettingsUpgradeNotice: () => <div>inbox-upgrade</div>,
}))

vi.mock('@/hooks/queries/inbox', () => ({
  useInboxConfig: mockUseInboxConfig,
}))

import { Inbox } from '@/app/workspace/[workspaceId]/settings/components/inbox/inbox'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('Inbox entitlement states', () => {
  it('shows a load failure instead of an upgrade notice when entitlement is unknown', () => {
    mockUseInboxConfig.mockReturnValue({
      data: undefined,
      error: new Error('Inbox request failed'),
      isLoading: false,
    })

    act(() => root.render(<Inbox />))

    expect(container.textContent).toContain('Inbox request failed')
    expect(container.textContent).not.toContain('inbox-upgrade')
  })

  it('preserves the upgrade notice for a successful non-entitled response', () => {
    mockUseInboxConfig.mockReturnValue({
      data: { enabled: false, entitled: false },
      error: null,
      isLoading: false,
    })

    act(() => root.render(<Inbox />))

    expect(container.textContent).toContain('inbox-upgrade')
  })
})
