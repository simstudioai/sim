/**
 * @vitest-environment jsdom
 *
 * Who may create a custom block depends on the viewer's workspaces, a read of its own. Failure
 * modes: that read failing silently, hiding Create block as if the viewer lacked the right; and a
 * deep link flashing the list before the block it names has loaded.
 */
import { act } from 'react'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const reads = vi.hoisted(() => ({
  refetchWorkspaces: vi.fn(),
  blockParam: null as string | null,
  blocks: { data: [] as unknown[] | undefined, isPending: false, isPlaceholderData: false },
}))
vi.mock('@/platform/lib/data/settings-subview', () => ({
  useSettingsSubview: () => ({
    id: reads.blockParam,
    creating: false,
    open: vi.fn(),
    close: vi.fn(),
    create: vi.fn(),
    showCreated: vi.fn(),
  }),
}))
vi.mock('@/platform/lib/data/workspace-settings', () => ({
  useWorkspaceSettingsSection: () => ({ canMutate: true, hostContext: null }),
}))
vi.mock('@/platform/lib/data/custom-blocks', () => ({
  customBlockIdParam: { key: 'custom-block-id' },
  useCanPublishCustomBlock: () => ({ isPending: false, data: true }),
  useCustomBlocks: () => ({
    ...reads.blocks,
    error: null,
    isLoadingError: false,
    isRefetchError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useSettingsSearch: () => ['', vi.fn()],
  useWhitelabelSettings: () => ({ data: undefined }),
  useWorkspacesQuery: () => ({
    data: undefined,
    isError: true,
    isFetching: false,
    error: new Error('Network down'),
    refetch: reads.refetchWorkspaces,
  }),
}))

import CustomBlocksSection from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/custom-blocks/custom-blocks-section'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubResizeObserver()
  reads.blockParam = null
  reads.blocks = { data: [], isPending: false, isPlaceholderData: false }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

it('shows a failed workspace read with Retry', async () => {
  act(() => root.render(<CustomBlocksSection workspaceId='ws' subpath={[]} />))
  const retry = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Retry')
  await act(async () => retry?.click())
  expect(reads.refetchWorkspaces).toHaveBeenCalled()
})

it('shows nothing for a deep link while the list is still loading', () => {
  reads.blockParam = 'block-1'
  reads.blocks = { data: undefined, isPending: true, isPlaceholderData: false }
  act(() => root.render(<CustomBlocksSection workspaceId='ws' subpath={[]} />))
  expect(container.childElementCount).toBe(0)
})
