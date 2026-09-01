/**
 * @vitest-environment node
 */
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
  it('interleaves folders and items on the sort key instead of hoisting folders', () => {
    const sorted = sortResources(
      [
        entry('b-folder', 'folder', 'b-folder'),
        entry('a-item', 'item', 'a-item'),
        entry('c-item', 'item', 'c-item'),
      ],
      'asc'
    )

    expect(names(sorted)).toEqual(['a-item', 'b-folder', 'c-item'])
  })

  it('floats a pinned item above every unpinned folder', () => {
    const sorted = sortResources(
      [
        entry('a-folder', 'folder', 'a-folder'),
        entry('b-folder', 'folder', 'b-folder'),
        entry('z-item', 'item', 'z-item', true),
      ],
      'asc'
    )

    expect(names(sorted)).toEqual(['z-item', 'a-folder', 'b-folder'])
  })

  it('keeps pinned rows on top when the direction flips', () => {
    const sorted = sortResources(
      [
        entry('a-folder', 'folder', 3),
        entry('b-item', 'item', 2),
        entry('c-item', 'item', 1, true),
      ],
      'desc'
    )

    expect(names(sorted)).toEqual(['c-item', 'a-folder', 'b-item'])
  })

  it('orders pinned rows among themselves by the active key', () => {
    const sorted = sortResources(
      [
        entry('a-item', 'item', 1, true),
        entry('b-folder', 'folder', 3, true),
        entry('c-item', 'item', 2, true),
      ],
      'desc'
    )

    expect(names(sorted)).toEqual(['b-folder', 'c-item', 'a-item'])
  })

  it('sorts rows with no value for the column last in both directions', () => {
    const rows = [
      entry('folder-a', 'folder', null),
      entry('item-big', 'item', 10),
      entry('item-small', 'item', 1),
    ]

    expect(names(sortResources([...rows], 'asc'))).toEqual(['item-small', 'item-big', 'folder-a'])
    expect(names(sortResources([...rows], 'desc'))).toEqual(['item-big', 'item-small', 'folder-a'])
  })

  it('still floats a pinned row that has no value for the column', () => {
    const sorted = sortResources(
      [entry('item-a', 'item', 5), entry('folder-z', 'folder', null, true)],
      'asc'
    )

    expect(names(sorted)).toEqual(['folder-z', 'item-a'])
  })

  it('sorts a row whose cell renders empty last, not first', () => {
    // An owner id that resolves to no workspace member renders an empty cell, so its key is
    // `null` — passing `''` instead would float those rows to the top of an ascending sort.
    const rows = [entry('unknown-owner', 'item', null), entry('ada', 'item', 'Ada')]

    expect(names(sortResources([...rows], 'asc'))).toEqual(['ada', 'unknown-owner'])
    expect(names(sortResources([...rows], 'desc'))).toEqual(['ada', 'unknown-owner'])
  })

  it('breaks ties by name ascending regardless of direction', () => {
    const rows = [
      entry('charlie', 'item', 1),
      entry('alpha', 'folder', 1),
      entry('bravo', 'item', 1),
    ]

    expect(names(sortResources([...rows], 'asc'))).toEqual(['alpha', 'bravo', 'charlie'])
    expect(names(sortResources([...rows], 'desc'))).toEqual(['alpha', 'bravo', 'charlie'])
  })

  it('breaks ties by name among rows that all lack a value', () => {
    const sorted = sortResources(
      [entry('zeta', 'folder', null), entry('alpha', 'folder', null)],
      'desc'
    )

    expect(names(sorted)).toEqual(['alpha', 'zeta'])
  })

  it('compares string keys case-insensitively via localeCompare', () => {
    const sorted = sortResources(
      [entry('Beta', 'item', 'Beta'), entry('alpha', 'folder', 'alpha')],
      'asc'
    )

    expect(names(sorted)).toEqual(['alpha', 'Beta'])
  })
})
