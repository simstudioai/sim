import { describe, expect, it } from 'vitest'
import { folderAncestorChain } from '@/lib/folders/tree'
import { breadcrumbFolderChain } from '@/app/workspace/[workspaceId]/components/folders/folder-breadcrumbs'
import { nextUntitledFolderName } from '@/app/workspace/[workspaceId]/components/folders/folder-naming'
import { parseFolderedRowId } from '@/app/workspace/[workspaceId]/components/folders/folder-row-id'
import {
  buildDescendantIndex,
  buildMoveOptions,
  buildMoveOptionsExcludingSubtrees,
  ROOT_MOVE_OPTION_VALUE,
} from '@/app/workspace/[workspaceId]/components/folders/move-options'
import type { WorkflowFolder } from '@/stores/folders/types'

function makeFolder(
  id: string,
  parentId: string | null = null,
  overrides: Partial<WorkflowFolder> = {}
): WorkflowFolder {
  return {
    id,
    name: id,
    userId: 'u-1',
    workspaceId: 'ws-1',
    parentId,
    resourceType: 'knowledge_base',
    locked: false,
    sortOrder: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
}

describe('folder row ids', () => {
  it('treats an unprefixed id as the resource, so pre-folder row ids still resolve', () => {
    expect(parseFolderedRowId('kb-1')).toEqual({ kind: 'resource', id: 'kb-1' })
  })

  it('does not mistake a resource id that merely contains the prefix for a folder', () => {
    expect(parseFolderedRowId('kb-folder:1')).toEqual({ kind: 'resource', id: 'kb-folder:1' })
  })
})

describe('nextUntitledFolderName', () => {
  it('suffixes past every taken sibling name', () => {
    const folders = [
      makeFolder('a', null, { name: 'New folder' }),
      makeFolder('b', null, { name: 'New folder (1)' }),
    ]
    expect(nextUntitledFolderName(folders, null)).toBe('New folder (2)')
  })

  it('only considers siblings under the same parent', () => {
    const folders = [makeFolder('a', 'p-1', { name: 'New folder' })]
    expect(nextUntitledFolderName(folders, null)).toBe('New folder')
    expect(nextUntitledFolderName(folders, 'p-1')).toBe('New folder (1)')
  })
})

describe('buildDescendantIndex', () => {
  it('terminates on a cycle instead of recursing forever', () => {
    const index = buildDescendantIndex([makeFolder('a', 'b'), makeFolder('b', 'a')])
    expect(index.has('a')).toBe(true)
    expect(index.has('b')).toBe(true)
  })
})

describe('buildMoveOptions', () => {
  const folders = [makeFolder('root'), makeFolder('child', 'root'), makeFolder('sibling')]

  it('excludes the moved folder and its subtree, so a move cannot close a cycle', () => {
    const excluded = new Set(['root', ...(buildDescendantIndex(folders).get('root') ?? [])])
    const options = buildMoveOptions({
      folders,
      rootLabel: 'Knowledge Base',
      excludedFolderIds: excluded,
    })

    expect(options.map((option) => option.value)).toEqual([ROOT_MOVE_OPTION_VALUE, 'sibling'])
  })

  it('does not mutate the caller folder array while sorting', () => {
    const source = [...folders]
    buildMoveOptions({ folders: source, rootLabel: 'Knowledge Base' })
    expect(source.map((folder) => folder.id)).toEqual(['root', 'child', 'sibling'])
  })
})

describe('breadcrumbFolderChain', () => {
  function mapOf(...folders: WorkflowFolder[]) {
    return new Map(folders.map((folder) => [folder.id, folder]))
  }

  it('collapses the whole chain when an ancestor does not resolve, rather than skipping a level', () => {
    const chain = breadcrumbFolderChain('leaf', mapOf(makeFolder('leaf', 'gone')))
    expect(chain).toEqual([])
  })

  it('collapses a parent cycle the DB permits between constraint checks, rather than hanging', () => {
    const chain = breadcrumbFolderChain('a', mapOf(makeFolder('a', 'b'), makeFolder('b', 'a')))
    expect(chain).toEqual([])
  })
})

describe('folderAncestorChain', () => {
  it('stops on a cycle instead of looping forever', () => {
    const folders: Record<string, WorkflowFolder> = {
      a: makeFolder('a', 'b'),
      b: makeFolder('b', 'a'),
    }
    expect(folderAncestorChain('a', (id) => folders[id]).map((f) => f.id)).toEqual(['b', 'a'])
  })
})

describe('buildMoveOptionsExcludingSubtrees', () => {
  /** `a` holds `a1`, which holds `a1x`; `b` is an unrelated sibling. */
  const folders = [makeFolder('a'), makeFolder('a1', 'a'), makeFolder('a1x', 'a1'), makeFolder('b')]
  const descendantsByFolderId = buildDescendantIndex(folders)
  const valuesOf = (nodes: ReturnType<typeof buildMoveOptions>): string[] =>
    nodes.flatMap((node) => [node.value, ...valuesOf(node.children)])

  it('excludes a moving folder and its whole subtree, never offering a cycle', () => {
    // The invariant this helper exists to hold: a folder can never be filed into itself or
    // anything beneath it, at any depth.
    const options = buildMoveOptionsExcludingSubtrees({
      folders,
      rootLabel: 'Root',
      excludeFolderIds: ['a'],
      descendantsByFolderId,
    })
    expect(valuesOf(options)).toEqual([ROOT_MOVE_OPTION_VALUE, 'b'])
  })

  it('excludes the union of several selected subtrees', () => {
    const options = buildMoveOptionsExcludingSubtrees({
      folders,
      rootLabel: 'Root',
      excludeFolderIds: ['a1', 'b'],
      descendantsByFolderId,
    })
    expect(valuesOf(options)).toEqual([ROOT_MOVE_OPTION_VALUE, 'a'])
  })

  it('always keeps the workspace root as a destination', () => {
    const options = buildMoveOptionsExcludingSubtrees({
      folders,
      rootLabel: 'Root',
      excludeFolderIds: ['a', 'b'],
      descendantsByFolderId,
    })
    expect(valuesOf(options)).toEqual([ROOT_MOVE_OPTION_VALUE])
  })
})
