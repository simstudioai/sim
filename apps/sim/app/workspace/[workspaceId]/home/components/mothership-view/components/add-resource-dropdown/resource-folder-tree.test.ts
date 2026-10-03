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
  it('surfaces items whose folder is unknown at the root instead of dropping them', () => {
    const tree = buildResourceFolderTree([item('orphan', 'deleted-folder')], [folder('f1')])
    expect(shape(tree)).toEqual(['f1[]', 'orphan'])
  })

  it('surfaces folders whose parent is unknown at the root', () => {
    const tree = buildResourceFolderTree([item('child', 'f1')], [folder('f1', 'deleted-parent')])
    expect(shape(tree)).toEqual(['f1[child]'])
  })

  it('prunes folders with no items at any depth when pruneEmpty is set', () => {
    const tree = buildResourceFolderTree(
      [item('kept', 'full')],
      [folder('full'), folder('empty'), folder('emptyChild', 'empty')],
      { pruneEmpty: true }
    )
    expect(shape(tree)).toEqual(['full[kept]'])
  })

  it('drops folders in a parent cycle rather than rooting them, so the walk terminates', () => {
    const tree = buildResourceFolderTree([item('rootItem')], [folder('a', 'b'), folder('b', 'a')], {
      pruneEmpty: false,
    })
    expect(shape(tree)).toEqual(['rootItem'])
  })
})
