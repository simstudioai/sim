import { describe, expect, it } from 'vitest'
import {
  type SortableResource,
  sortResources,
} from '@/app/workspace/[workspaceId]/components/folders/resource-sort'

type Kind = 'folder' | 'item'

function entry(
  name: string,
  kind: Kind,
  key: string | number | null,
  pinned = false
): SortableResource<{ name: string; kind: Kind }> {
  return { item: { name, kind }, pinned, name, key }
}

const names = (entries: SortableResource<{ name: string; kind: Kind }>[]) =>
  entries.map((e) => e.item.name)

describe('sortResources', () => {
  it('sorts rows with no value for the column last in both directions', () => {
    const rows = [
      entry('folder-a', 'folder', null),
      entry('item-big', 'item', 10),
      entry('item-small', 'item', 1),
    ]

    expect(names(sortResources([...rows], 'asc'))).toEqual(['item-small', 'item-big', 'folder-a'])
    expect(names(sortResources([...rows], 'desc'))).toEqual(['item-big', 'item-small', 'folder-a'])
  })

  it('sorts a row whose cell renders empty last, not first', () => {
    // An owner id that resolves to no workspace member renders an empty cell, so its key is
    // `null` — passing `''` instead would float those rows to the top of an ascending sort.
    const rows = [entry('unknown-owner', 'item', null), entry('ada', 'item', 'Ada')]

    expect(names(sortResources([...rows], 'asc'))).toEqual(['ada', 'unknown-owner'])
    expect(names(sortResources([...rows], 'desc'))).toEqual(['ada', 'unknown-owner'])
  })
})
