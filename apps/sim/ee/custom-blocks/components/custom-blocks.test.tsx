/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseCanPublishCustomBlock } = vi.hoisted(() => ({
  mockUseCanPublishCustomBlock: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({ ChipTag: () => null }))
vi.mock('@sim/emcn/icons', () => ({ Plus: () => null }))
vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
}))
vi.mock('nuqs', () => ({ useQueryState: () => [null, vi.fn()] }))
vi.mock('@/components/settings/navigation', () => ({
  canMutateWorkspaceSettingsSection: () => true,
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => ({ isLoading: false }),
}))
vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-empty-state', () => ({
  SettingsEmptyState: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
}))
vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-resource-row', () => ({
  RESOURCE_LIST_STACK: '',
  SettingsResourceRow: () => null,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section',
  () => ({
    SettingsSection: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
  })
)
vi.mock('@/app/workspace/[workspaceId]/settings/components/use-settings-search', () => ({
  useSettingsSearch: () => ['', vi.fn()],
}))
vi.mock('@/blocks/custom/custom-block-icon', () => ({
  getCustomBlockIcon: () => () => null,
}))
vi.mock('@/ee/custom-blocks/components/custom-block-detail', () => ({
  CustomBlockDetail: () => null,
}))
vi.mock('@/ee/whitelabeling/components/branding-provider', () => ({
  useOrgBrandConfig: () => ({}),
}))
vi.mock('@/hooks/queries/custom-blocks', () => ({
  useCanPublishCustomBlock: mockUseCanPublishCustomBlock,
  useCustomBlocks: () => ({ data: [] }),
}))
vi.mock('@/hooks/queries/workspace', () => ({
  useWorkspacesQuery: () => ({ data: [] }),
}))

import { CustomBlocks } from '@/ee/custom-blocks/components/custom-blocks'

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

describe('CustomBlocks entitlement states', () => {
  it('shows a load failure instead of an Enterprise notice when access is unknown', () => {
    mockUseCanPublishCustomBlock.mockReturnValue({
      data: undefined,
      error: new Error('Custom block access failed'),
      isLoading: false,
    })

    act(() => root.render(<CustomBlocks />))

    expect(container.textContent).toContain('Custom block access failed')
    expect(container.textContent).not.toContain('require an Enterprise plan')
  })

  it('preserves the Enterprise notice for a successful non-entitled response', () => {
    mockUseCanPublishCustomBlock.mockReturnValue({ data: false, error: null, isLoading: false })

    act(() => root.render(<CustomBlocks />))

    expect(container.textContent).toContain('require an Enterprise plan')
  })
})
