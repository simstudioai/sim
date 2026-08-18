/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { folderAncestorChain } from '@/lib/folders/tree'
import {
  breadcrumbFolderChain,
  folderBreadcrumbItems,
} from '@/app/workspace/[workspaceId]/components/folders/folder-breadcrumbs'
import { nextUntitledFolderName } from '@/app/workspace/[workspaceId]/components/folders/folder-naming'
import {
  folderRowId,
  parseFolderedRowId,
  splitFolderedRowIds,
} from '@/app/workspace/[workspaceId]/components/folders/folder-row-id'
import {
  buildDescendantIndex,
  buildMoveOptions,
  buildMoveOptionsExcludingSubtrees,
  parseMoveOptionValue,
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
  it('round-trips a folder id through the namespaced row id', () => {
    expect(parseFolderedRowId(folderRowId('f-1'))).toEqual({ kind: 'folder', id: 'f-1' })
  })

  it('treats an unprefixed id as the resource, so pre-folder row ids still resolve', () => {
    expect(parseFolderedRowId('kb-1')).toEqual({ kind: 'resource', id: 'kb-1' })
  })

  it('does not mistake a resource id that merely contains the prefix for a folder', () => {
    expect(parseFolderedRowId('kb-folder:1')).toEqual({ kind: 'resource', id: 'kb-folder:1' })
  })

  it('keeps a folder id containing a colon intact', () => {
    expect(parseFolderedRowId(folderRowId('a:b'))).toEqual({ kind: 'folder', id: 'a:b' })
  })
})

describe('nextUntitledFolderName', () => {
  it('uses the bare name when no sibling holds it', () => {
    expect(nextUntitledFolderName([], null)).toBe('New folder')
  })

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
  it('collects transitive descendants', () => {
    const index = buildDescendantIndex([
      makeFolder('root'),
      makeFolder('child', 'root'),
      makeFolder('grandchild', 'child'),
      makeFolder('other'),
    ])

    expect([...(index.get('root') ?? [])].sort()).toEqual(['child', 'grandchild'])
    expect([...(index.get('child') ?? [])]).toEqual(['grandchild'])
    expect([...(index.get('other') ?? [])]).toEqual([])
  })

  it('terminates on a cycle instead of recursing forever', () => {
    const index = buildDescendantIndex([makeFolder('a', 'b'), makeFolder('b', 'a')])
    expect(index.has('a')).toBe(true)
    expect(index.has('b')).toBe(true)
  })
})

describe('buildMoveOptions', () => {
  const folders = [makeFolder('root'), makeFolder('child', 'root'), makeFolder('sibling')]

  it('leads with the root sentinel', () => {
    const options = buildMoveOptions({ folders, rootLabel: 'Knowledge Base' })
    expect(options[0]).toEqual({
      value: ROOT_MOVE_OPTION_VALUE,
      label: 'Knowledge Base',
      children: [],
    })
  })

  it('nests descendants under their parent', () => {
    const options = buildMoveOptions({
      folders: [...folders, makeFolder('grandchild', 'child')],
      rootLabel: 'Knowledge Base',
    })
    const root = options.find((option) => option.value === 'root')
    expect(root?.children.map((child) => child.value)).toEqual(['child'])
    expect(root?.children[0].children.map((child) => child.value)).toEqual(['grandchild'])
  })

  it('excludes the moved folder and its subtree, so a move cannot close a cycle', () => {
    const excluded = new Set(['root', ...(buildDescendantIndex(folders).get('root') ?? [])])
    const options = buildMoveOptions({
      folders,
      rootLabel: 'Knowledge Base',
      excludedFolderIds: excluded,
    })

    expect(options.map((option) => option.value)).toEqual([ROOT_MOVE_OPTION_VALUE, 'sibling'])
  })

  it('still offers the root when every folder is excluded', () => {
    const options = buildMoveOptions({
      folders,
      rootLabel: 'Knowledge Base',
      excludedFolderIds: new Set(['root', 'child', 'sibling']),
    })
    expect(options).toHaveLength(1)
    expect(options[0].value).toBe(ROOT_MOVE_OPTION_VALUE)
  })

  it('offers every folder when nothing is excluded, as for a resource with no subtree', () => {
    const options = buildMoveOptions({ folders, rootLabel: 'Knowledge Base' })
    expect(options.map((option) => option.value)).toEqual([
      ROOT_MOVE_OPTION_VALUE,
      'root',
      'sibling',
    ])
  })

  it('orders siblings by sortOrder, then name', () => {
    const options = buildMoveOptions({
      folders: [
        makeFolder('b', null, { name: 'B', sortOrder: 1 }),
        makeFolder('a', null, { name: 'A', sortOrder: 2 }),
      ],
      rootLabel: 'Knowledge Base',
    })
    expect(options.slice(1).map((option) => option.label)).toEqual(['B', 'A'])
  })

  it('does not mutate the caller folder array while sorting', () => {
    const source = [...folders]
    buildMoveOptions({ folders: source, rootLabel: 'Knowledge Base' })
    expect(source.map((folder) => folder.id)).toEqual(['root', 'child', 'sibling'])
  })
})

describe('parseMoveOptionValue', () => {
  it('decodes the root sentinel to null', () => {
    expect(parseMoveOptionValue(ROOT_MOVE_OPTION_VALUE)).toBeNull()
  })

  it('passes a folder id through unchanged', () => {
    expect(parseMoveOptionValue('folder-1')).toBe('folder-1')
  })
})

describe('folderBreadcrumbItems', () => {
  it('renders the root alone when no folder is open, so the header falls back to a title', () => {
    const items = folderBreadcrumbItems({
      rootLabel: 'Knowledge Base',
      breadcrumbs: [],
      onNavigate: vi.fn(),
    })
    expect(items).toHaveLength(1)
    expect(items[0].label).toBe('Knowledge Base')
  })

  it('prepends the root crumb to the ancestor chain', () => {
    const items = folderBreadcrumbItems({
      rootLabel: 'Tables',
      breadcrumbs: [
        makeFolder('root', null, { name: 'Alpha' }),
        makeFolder('leaf', 'root', { name: 'Beta' }),
      ],
      onNavigate: vi.fn(),
    })
    expect(items.map((item) => item.label)).toEqual(['Tables', 'Alpha', 'Beta'])
  })

  it('navigates to null from the root crumb and to the folder id from an ancestor', () => {
    const onNavigate = vi.fn()
    const items = folderBreadcrumbItems({
      rootLabel: 'Tables',
      breadcrumbs: [makeFolder('root'), makeFolder('leaf', 'root')],
      onNavigate,
    })

    items[0].onClick?.()
    items[1].onClick?.()

    expect(onNavigate).toHaveBeenNthCalledWith(1, null)
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'root')
  })

  it('attaches the rename session and actions to the current folder only', () => {
    const currentFolderEditing = {
      isEditing: true,
      value: 'x',
      onChange: vi.fn(),
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    }
    const currentFolderActions = [{ label: 'Rename', onClick: vi.fn() }]
    const items = folderBreadcrumbItems({
      rootLabel: 'Knowledge Base',
      breadcrumbs: [makeFolder('root'), makeFolder('leaf', 'root')],
      onNavigate: vi.fn(),
      currentFolderEditing,
      currentFolderActions,
    })

    expect(items[1].onClick).toBeTypeOf('function')
    expect(items[1].editing).toBeUndefined()
    expect(items[1].dropdownItems).toBeUndefined()
    expect(items[2].onClick).toBeUndefined()
    expect(items[2].editing).toBe(currentFolderEditing)
    expect(items[2].dropdownItems).toBe(currentFolderActions)
  })

  it('appends the trailing crumbs of a detail page after the folder chain', () => {
    const items = folderBreadcrumbItems({
      rootLabel: 'Tables',
      breadcrumbs: [makeFolder('root', null, { name: 'Alpha' })],
      onNavigate: vi.fn(),
      trailing: [{ label: 'Q3' }],
    })
    expect(items.map((item) => item.label)).toEqual(['Tables', 'Alpha', 'Q3'])
  })

  it('makes every folder crumb navigable once a trailing crumb is where you are', () => {
    const onNavigate = vi.fn()
    const items = folderBreadcrumbItems({
      rootLabel: 'Tables',
      breadcrumbs: [makeFolder('root'), makeFolder('leaf', 'root')],
      onNavigate,
      trailing: [{ label: 'Q3' }],
    })

    items[2].onClick?.()
    expect(onNavigate).toHaveBeenCalledWith('leaf')
  })

  it('leaves the deepest folder crumb plain on a detail page — the rename and menu are list-only', () => {
    const items = folderBreadcrumbItems({
      rootLabel: 'Tables',
      breadcrumbs: [makeFolder('leaf')],
      onNavigate: vi.fn(),
      trailing: [{ label: 'Q3' }],
    })

    expect(items[1].dropdownItems).toBeUndefined()
    expect(items[1].editing).toBeUndefined()
  })
})

describe('breadcrumbFolderChain', () => {
  function mapOf(...folders: WorkflowFolder[]) {
    return new Map(folders.map((folder) => [folder.id, folder]))
  }

  it('returns nothing at the workspace root', () => {
    expect(breadcrumbFolderChain(null, mapOf(makeFolder('a')))).toEqual([])
    expect(breadcrumbFolderChain(undefined, mapOf(makeFolder('a')))).toEqual([])
  })

  it('walks parentId up to the root and returns the chain root-first', () => {
    const chain = breadcrumbFolderChain(
      'leaf',
      mapOf(makeFolder('root'), makeFolder('mid', 'root'), makeFolder('leaf', 'mid'))
    )
    expect(chain.map((folder) => folder.id)).toEqual(['root', 'mid', 'leaf'])
  })

  it('collapses the whole chain when an ancestor does not resolve, rather than skipping a level', () => {
    const chain = breadcrumbFolderChain('leaf', mapOf(makeFolder('leaf', 'gone')))
    expect(chain).toEqual([])
  })

  it('collapses a parent cycle the DB permits between constraint checks, rather than hanging', () => {
    const chain = breadcrumbFolderChain('a', mapOf(makeFolder('a', 'b'), makeFolder('b', 'a')))
    expect(chain).toEqual([])
  })

  it('collapses a chain the folder map is still too incomplete to root', () => {
    const chain = breadcrumbFolderChain(
      'leaf',
      mapOf(makeFolder('mid', 'root'), makeFolder('leaf', 'mid'))
    )
    expect(chain).toEqual([])
  })
})

describe('folderAncestorChain', () => {
  it('keeps the part it walked when a link does not resolve — the breadcrumb rule is a wrapper', () => {
    const folders: Record<string, WorkflowFolder> = { leaf: makeFolder('leaf', 'gone') }
    const chain = folderAncestorChain('leaf', (id) => folders[id])
    expect(chain.map((folder) => folder.id)).toEqual(['leaf'])
  })

  it('stops on a cycle instead of looping forever', () => {
    const folders: Record<string, WorkflowFolder> = {
      a: makeFolder('a', 'b'),
      b: makeFolder('b', 'a'),
    }
    expect(folderAncestorChain('a', (id) => folders[id]).map((f) => f.id)).toEqual(['b', 'a'])
  })
})

describe('splitFolderedRowIds', () => {
  it('separates folder rows from resource rows', () => {
    const { folderIds, resourceIds } = splitFolderedRowIds([
      folderRowId('f-1'),
      'res-1',
      folderRowId('f-2'),
      'res-2',
    ])

    expect(folderIds).toEqual(['f-1', 'f-2'])
    expect(resourceIds).toEqual(['res-1', 'res-2'])
  })

  it('returns empty lists for an empty selection', () => {
    expect(splitFolderedRowIds([])).toEqual({ folderIds: [], resourceIds: [] })
  })

  it('accepts a Set, which is how a selection is actually held', () => {
    const { folderIds, resourceIds } = splitFolderedRowIds(new Set([folderRowId('f-1'), 'res-1']))
    expect(folderIds).toEqual(['f-1'])
    expect(resourceIds).toEqual(['res-1'])
  })
})

describe('buildMoveOptionsExcludingSubtrees', () => {
  /** `a` holds `a1`, which holds `a1x`; `b` is an unrelated sibling. */
  const folders = [makeFolder('a'), makeFolder('a1', 'a'), makeFolder('a1x', 'a1'), makeFolder('b')]
  const descendantsByFolderId = buildDescendantIndex(folders)
  const valuesOf = (nodes: ReturnType<typeof buildMoveOptions>): string[] =>
    nodes.flatMap((node) => [node.value, ...valuesOf(node.children)])

  it('offers every folder when nothing is excluded', () => {
    const options = buildMoveOptionsExcludingSubtrees({
      folders,
      rootLabel: 'Root',
      excludeFolderIds: [],
      descendantsByFolderId,
    })
    expect(valuesOf(options)).toEqual([ROOT_MOVE_OPTION_VALUE, 'a', 'a1', 'a1x', 'b'])
  })

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

describe('folderBreadcrumbItems drag destinations', () => {
  const chain = [makeFolder('a'), makeFolder('a1', 'a')]

  it('names the folder each crumb points at, so the header can accept a drop on it', () => {
    const items = folderBreadcrumbItems({
      rootLabel: 'Files',
      breadcrumbs: chain,
      onNavigate: vi.fn(),
    })

    expect(items.map((item) => item.folderId)).toEqual([null, 'a', 'a1'])
  })

  it('leaves a trailing crumb without a folder id, so it stays inert', () => {
    const items = folderBreadcrumbItems({
      rootLabel: 'Files',
      breadcrumbs: chain,
      onNavigate: vi.fn(),
      trailing: [{ label: 'report.md', terminal: true }],
    })

    expect(items.at(-1)).toMatchObject({ label: 'report.md' })
    expect(items.at(-1)?.folderId).toBeUndefined()
  })

  it('gives the root crumb null rather than omitting it — the root is a real destination', () => {
    const items = folderBreadcrumbItems({
      rootLabel: 'Files',
      breadcrumbs: [],
      onNavigate: vi.fn(),
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toHaveProperty('folderId', null)
  })
})
