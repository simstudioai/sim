import { describe, expect, it } from 'vitest'
import { buildForkSyncWorkflowTree } from '@/ee/workspace-forking/components/fork-synced-workflows/fork-synced-workflows'

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

  /**
   * The folder-level select-all writes this list verbatim, so a subtree that misses a
   * nested workflow silently leaves it out of a "sync all in this folder" click.
   */
  it('collects nested descendants into the parent folder select-all list', () => {
    const folders = [
      { id: 'parent', name: 'Parent', parentId: null, sortOrder: 0 },
      { id: 'child', name: 'Child', parentId: 'parent', sortOrder: 0 },
    ]
    const tree = buildForkSyncWorkflowTree(
      [wf({ id: 'top', folderId: 'parent' }), wf({ id: 'nested', folderId: 'child' })] as never,
      folders as never
    )
    expect([...tree.folders[0].descendantWorkflowIds].sort()).toEqual(['nested', 'top'])
  })
})
