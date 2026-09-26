/**
 * @vitest-environment jsdom
 *
 * Covers the polarity inversion this component owns. The stored column is the NEGATIVE
 * `forkSyncExcluded`; the UI reads positively ("checked = syncs"). Get the inversion
 * backwards and every workflow silently flips its sync participation, which is why the
 * checked set and the value sent on toggle are both asserted here.
 */
import { act, type ReactNode } from 'react'
import { emcnMock } from '@sim/testing/mocks/emcn.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseWorkflows, mockUseFolders, mockMutate } = vi.hoisted(() => ({
  mockUseWorkflows: vi.fn(),
  mockUseFolders: vi.fn(),
  mockMutate: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({
  ...emcnMock,
  ChevronDown: (props: { className?: string }) => <span {...props} />,
  OverflowText: ({ label, children }: { label?: string; children?: ReactNode }) => (
    <span>{children ?? label}</span>
  ),
  Checkbox: ({
    checked,
    onCheckedChange,
    disabled,
    id,
    'aria-label': ariaLabel,
  }: {
    checked: boolean | 'indeterminate'
    onCheckedChange: (value: boolean | 'indeterminate') => void
    disabled?: boolean
    id?: string
    'aria-label'?: string
  }) => (
    <button
      type='button'
      id={id}
      aria-label={ariaLabel}
      data-state={String(checked)}
      disabled={disabled}
      onClick={() => onCheckedChange(checked !== true)}
    />
  ),
}))
vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-empty-state', () => ({
  SettingsEmptyState: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/hooks/queries/workflows', () => ({ useWorkflows: mockUseWorkflows }))
vi.mock('@/hooks/queries/folders', () => ({ useFolders: mockUseFolders }))
vi.mock('@/ee/workspace-forking/hooks/workspace-fork', () => ({
  useUpdateForkSyncedWorkflows: () => ({ mutate: mockMutate, isPending: false }),
}))

import {
  buildForkSyncWorkflowTree,
  ForkSyncedWorkflows,
} from '@/ee/workspace-forking/components/fork-synced-workflows/fork-synced-workflows'

const wf = (over: Record<string, unknown>) => ({
  id: 'w',
  name: 'W',
  isDeployed: true,
  archivedAt: null,
  folderId: null,
  forkSyncExcluded: false,
  ...over,
})

describe('buildForkSyncWorkflowTree', () => {
  it('lists only deployed, non-archived workflows — the only ones that sync', () => {
    const tree = buildForkSyncWorkflowTree(
      [
        wf({ id: 'live', name: 'Live' }),
        wf({ id: 'draft', name: 'Draft', isDeployed: false }),
        wf({ id: 'gone', name: 'Gone', archivedAt: new Date() }),
      ] as never,
      []
    )
    expect(tree.rootWorkflows.map((w) => w.id)).toEqual(['live'])
  })

  it('falls a workflow whose folder was deleted back to root so it stays selectable', () => {
    const tree = buildForkSyncWorkflowTree([wf({ id: 'orphan', folderId: 'missing' })] as never, [])
    expect(tree.rootWorkflows.map((w) => w.id)).toEqual(['orphan'])
  })

  it('prunes folders with no deployed workflows anywhere beneath them', () => {
    const folders = [
      { id: 'f-empty', name: 'Empty', parentId: null, sortOrder: 0 },
      { id: 'f-full', name: 'Full', parentId: null, sortOrder: 1 },
    ]
    const tree = buildForkSyncWorkflowTree(
      [wf({ id: 'a', folderId: 'f-full' })] as never,
      folders as never
    )
    expect(tree.folders.map((f) => f.id)).toEqual(['f-full'])
  })
})

describe('ForkSyncedWorkflows polarity', () => {
  let container: HTMLDivElement
  let root: Root

  const render = () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(<ForkSyncedWorkflows workspaceId='ws-1' />)
    })
  }

  beforeEach(() => {
    mockUseFolders.mockReturnValue({ data: [], isLoading: false })
    mockUseWorkflows.mockReturnValue({
      data: [
        wf({ id: 'synced', name: 'Synced', forkSyncExcluded: false }),
        wf({ id: 'unsynced', name: 'Unsynced', forkSyncExcluded: true }),
      ],
      isLoading: false,
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  /** checked = syncs, so the EXCLUDED workflow must render unchecked. */
  it('checks the workflow that syncs and leaves the excluded one unchecked', () => {
    render()
    const boxes = [...container.querySelectorAll('button[data-state]')]
    expect(boxes.map((b) => b.getAttribute('data-state'))).toEqual(['true', 'false'])
  })

  it('sends forkSyncExcluded:false when a user checks a row to start syncing it', () => {
    render()
    const unsynced = container.querySelectorAll('button[data-state]')[1] as HTMLButtonElement
    act(() => unsynced.click())
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        body: { workflowIds: ['unsynced'], forkSyncExcluded: false },
      }),
      expect.anything()
    )
  })

  it('sends forkSyncExcluded:true when a user unchecks a row to stop syncing it', () => {
    render()
    const synced = container.querySelectorAll('button[data-state]')[0] as HTMLButtonElement
    act(() => synced.click())
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { workflowIds: ['synced'], forkSyncExcluded: true },
      }),
      expect.anything()
    )
  })

  it('shows a folder as indeterminate while only some of its subtree syncs', () => {
    mockUseFolders.mockReturnValue({
      data: [{ id: 'f1', name: 'Folder', parentId: null, sortOrder: 0 }],
      isLoading: false,
    })
    mockUseWorkflows.mockReturnValue({
      data: [
        wf({ id: 'a', folderId: 'f1', forkSyncExcluded: false }),
        wf({ id: 'b', folderId: 'f1', forkSyncExcluded: true }),
      ],
      isLoading: false,
    })
    render()
    const folderBox = container.querySelector('button[aria-label="Sync all in Folder"]')
    expect(folderBox?.getAttribute('data-state')).toBe('indeterminate')
  })
})
