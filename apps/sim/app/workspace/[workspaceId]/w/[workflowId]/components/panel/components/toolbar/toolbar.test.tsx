/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { addBlock, dragBlock, discovery, toolbarState } = vi.hoisted(() => ({
  addBlock: vi.fn(),
  dragBlock: vi.fn(),
  discovery: vi.fn(),
  toolbarState: {
    expandedSections: { triggers: true, blocks: true, customBlocks: true, tools: true },
    setSectionExpanded: vi.fn(),
  },
}))

vi.mock('next/navigation', () => ({ useParams: () => ({ workspaceId: 'workspace-1' }) }))
vi.mock('posthog-js/react', () => ({ usePostHog: () => null }))
vi.mock('@/lib/posthog/client', () => ({ captureEvent: vi.fn() }))
vi.mock('@sim/emcn', () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
    <button type='button' onClick={onClick}>
      {children}
    </button>
  ),
  chipVariants: () => '',
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  Expandable: ({ children, expanded }: { children: ReactNode; expanded: boolean }) =>
    expanded ? children : null,
  ExpandableContent: ({ children }: { children: ReactNode }) => children,
  Info: () => null,
  OverflowText: ({ label }: { label: string }) => <span>{label}</span>,
  handleKeyboardActivation: (event: React.KeyboardEvent, callback: () => void) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      callback()
    }
  },
}))
vi.mock('@sim/emcn/icons', () => ({
  ChevronDown: () => null,
  Lock: () => null,
  Search: () => null,
}))
vi.mock('@/blocks/block-tile', () => ({ BlockTile: () => null }))
vi.mock('@/blocks/custom/build-config', () => ({
  isCustomBlockType: () => false,
  buildCustomBlockConfig: vi.fn(),
}))
vi.mock('@/blocks/custom/client-overlay', () => ({ useCustomBlockOverlayVersion: () => 1 }))
vi.mock('@/blocks/custom/custom-block-icon', () => ({ getCustomBlockTile: vi.fn() }))
vi.mock('@/blocks/registry', () => ({
  getCanonicalBlocksByCategory: (category: string) =>
    category === 'blocks'
      ? [
          { name: 'Allowed core', type: 'allowed-core' },
          { name: 'Locked core', type: 'locked-core' },
        ]
      : [
          { name: 'Allowed tool', type: 'allowed-tool' },
          { name: 'Locked tool', type: 'locked-tool' },
        ],
}))
vi.mock('@/lib/workflows/triggers/trigger-utils', () => ({
  getTriggersForSidebar: () => [
    { name: 'Allowed trigger', type: 'allowed-trigger' },
    { name: 'Locked trigger', type: 'locked-trigger' },
  ],
  hasTriggerCapability: () => true,
}))
vi.mock('@/ee/whitelabeling/components/branding-provider', () => ({
  useOrgBrandConfig: () => ({}),
}))
vi.mock('@/hooks/queries/custom-blocks', () => ({ useCustomBlocks: () => ({ data: [] }) }))
vi.mock('@/hooks/use-sandbox-block-constraints', () => ({ useSandboxBlockConstraints: () => null }))
vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({
    filterBlocks: <T extends { type: string }>(items: T[]) =>
      items.filter((item) => !item.type.startsWith('locked-')),
    isBlockRequestable: (type: string) => type.startsWith('locked-'),
  }),
}))
vi.mock('@/components/access-requests/permission-access-boundary', () => ({
  useWorkspaceAccessRequestFeatures: discovery,
}))
vi.mock('@/components/access-requests/request-access-action', () => ({
  RequestAccessModal: ({ label, onClose }: { label: string; onClose: () => void }) => (
    <div role='dialog'>
      Request {label}
      <button type='button' onClick={onClose}>
        Close
      </button>
    </div>
  ),
}))
vi.mock('@/stores/panel', () => ({
  useToolbarStore: (selector: (state: typeof toolbarState) => unknown) => selector(toolbarState),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/toolbar/hooks',
  () => ({
    useToolbarItemInteractions: () => ({ handleItemClick: addBlock, handleDragStart: dragBlock }),
  })
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/toolbar/components',
  () => ({ ToolbarItemContextMenu: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/loop/loop-config',
  () => ({ LoopTool: { name: 'Loop', type: 'loop' } })
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/parallel/parallel-config',
  () => ({ ParallelTool: { name: 'Parallel', type: 'parallel' } })
)

import { Toolbar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/toolbar/toolbar'

describe('toolbar access requests', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    discovery.mockReturnValue({ data: { enabled: true } })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('places every enabled category above one restricted section in trigger/core/integration order', () => {
    act(() => root.render(<Toolbar />))
    const sections = Array.from(container.querySelectorAll('section'))
    expect(sections).toHaveLength(4)
    expect(sections.at(-1)?.getAttribute('aria-label')).toBe('Access required')
    expect(
      Array.from(sections.at(-1)!.querySelectorAll('[role="button"]')).map((row) => row.textContent)
    ).toEqual(['Locked trigger', 'Locked core', 'Locked tool'])
    expect(sections.slice(0, -1).every((section) => !section.textContent?.includes('Locked'))).toBe(
      true
    )
  })

  it.each(['click', 'Enter', ' '])(
    'opens a request with %s without inserting or dragging a block',
    (activation) => {
      act(() => root.render(<Toolbar />))
      const row = container.querySelector<HTMLDivElement>(
        '[aria-label="Request access to Locked tool"]'
      )!
      expect(row.draggable).toBe(false)
      act(() => {
        row.dispatchEvent(new Event('dragstart', { bubbles: true }))
        row.dispatchEvent(
          activation === 'click'
            ? new MouseEvent('click', { bubbles: true })
            : new KeyboardEvent('keydown', { key: activation, bubbles: true })
        )
      })
      expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
        'Request Locked tool'
      )
      expect(addBlock).not.toHaveBeenCalled()
      expect(dragBlock).not.toHaveBeenCalled()
    }
  )

  it('moves keyboard focus from enabled rows through the restricted section', async () => {
    act(() => root.render(<Toolbar />))
    act(() =>
      container.querySelector<HTMLDivElement>('[data-toolbar-root] > [role="button"]')!.click()
    )
    const input = container.querySelector('input')!
    act(() => input.focus())
    const rows = Array.from(
      container.querySelectorAll<HTMLDivElement>(
        '[aria-label^="Add "], [aria-label^="Request access to "]'
      )
    )
    for (const row of rows) {
      act(() =>
        document.activeElement!.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
        )
      )
      expect(document.activeElement).toBe(row)
    }
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Request access to Locked tool')
    expect(addBlock).not.toHaveBeenCalled()
  })

  it('restores existing hiding when requests are off', () => {
    discovery.mockReturnValue({ data: { enabled: false } })
    act(() => root.render(<Toolbar />))
    expect(container.textContent).not.toContain('Access required')
    expect(container.textContent).not.toContain('Locked')
  })
})
