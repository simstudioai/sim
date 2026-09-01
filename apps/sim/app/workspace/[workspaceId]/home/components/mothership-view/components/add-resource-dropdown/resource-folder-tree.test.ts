/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type AvailableItem,
  buildResourceFolderTree,
  type ResourceTreeNode,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/resource-folder-tree'

function item(id: string, folderId: string | null = null, sortOrder?: number): AvailableItem {
  return { id, name: id, folderId, ...(sortOrder === undefined ? {} : { sortOrder }) }
}

function folder(id: string, parentId: string | null = null, sortOrder?: number): AvailableItem {
  return { id, name: id, parentId, ...(sortOrder === undefined ? {} : { sortOrder }) }
}

/** Flattens to `id` strings, folders as `id[...children]`, for terse assertions. */
function shape(nodes: ResourceTreeNode[]): string[] {
  return nodes.map((node) =>
    node.kind === 'item' ? node.id : `${node.id}[${shape(node.children).join(',')}]`
  )
}

describe('buildResourceFolderTree', () => {
  it('nests items under their folder and keeps root items at the top level', () => {
    const tree = buildResourceFolderTree(
      [item('rootItem'), item('nested', 'f1'), item('deep', 'f2')],
      [folder('f1'), folder('f2', 'f1')]
    )
    expect(shape(tree)).toEqual(['f1[f2[deep],nested]', 'rootItem'])
  })

  it('exposes the full source item to the caller, not just id and name', () => {
    const source = { id: 't1', name: 'Table', folderId: null, custom: 42 }
    const [node] = buildResourceFolderTree([source], [])
    expect(node).toEqual({ kind: 'item', id: 't1', item: source })
  })

  it('surfaces items whose folder is unknown at the root instead of dropping them', () => {
    const tree = buildResourceFolderTree([item('orphan', 'deleted-folder')], [folder('f1')])
    expect(shape(tree)).toEqual(['f1[]', 'orphan'])
  })

  it('surfaces folders whose parent is unknown at the root', () => {
    const tree = buildResourceFolderTree([item('child', 'f1')], [folder('f1', 'deleted-parent')])
    expect(shape(tree)).toEqual(['f1[child]'])
  })

  it('keeps empty folders by default', () => {
    const tree = buildResourceFolderTree([], [folder('empty')])
    expect(shape(tree)).toEqual(['empty[]'])
  })

  it('prunes folders with no items at any depth when pruneEmpty is set', () => {
    const tree = buildResourceFolderTree(
      [item('kept', 'full')],
      [folder('full'), folder('empty'), folder('emptyChild', 'empty')],
      { pruneEmpty: true }
    )
    expect(shape(tree)).toEqual(['full[kept]'])
  })

  it('interleaves folders and items by name by default', () => {
    const tree = buildResourceFolderTree(
      [item('apple'), item('cherry')],
      [folder('banana'), folder('date')]
    )
    expect(shape(tree)).toEqual(['apple', 'banana[]', 'cherry', 'date[]'])
  })

  it('orders nested levels by name too', () => {
    const tree = buildResourceFolderTree(
      [item('zebra', 'parent'), item('alpha', 'parent')],
      [folder('parent'), folder('middle', 'parent')]
    )
    expect(shape(tree)).toEqual(['parent[alpha,middle[],zebra]'])
  })

  it('breaks name ties by id so ordering stays stable', () => {
    const tree = buildResourceFolderTree(
      [
        { id: 'b', name: 'same', folderId: null },
        { id: 'a', name: 'same', folderId: null },
      ],
      []
    )
    expect(shape(tree)).toEqual(['a', 'b'])
  })

  it('interleaves folders and items by sortOrder when orderBySortOrder is set', () => {
    const tree = buildResourceFolderTree(
      [item('itemA', null, 1), item('itemC', null, 3)],
      [folder('folderB', null, 2)],
      { orderBySortOrder: true, pruneEmpty: false }
    )
    expect(shape(tree)).toEqual(['itemA', 'folderB[]', 'itemC'])
  })

  it('breaks sortOrder ties by id so ordering stays stable', () => {
    const tree = buildResourceFolderTree([item('b', null, 0), item('a', null, 0)], [], {
      orderBySortOrder: true,
    })
    expect(shape(tree)).toEqual(['a', 'b'])
  })

  it('treats a missing sortOrder as 0 rather than sorting it last', () => {
    const tree = buildResourceFolderTree([item('withOrder', null, 5), item('noOrder')], [], {
      orderBySortOrder: true,
    })
    expect(shape(tree)).toEqual(['noOrder', 'withOrder'])
  })

  it('drops folders in a parent cycle rather than rooting them, so the walk terminates', () => {
    const tree = buildResourceFolderTree([item('rootItem')], [folder('a', 'b'), folder('b', 'a')], {
      pruneEmpty: false,
    })
    expect(shape(tree)).toEqual(['rootItem'])
  })
})
