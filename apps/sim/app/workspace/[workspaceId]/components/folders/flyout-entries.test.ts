/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildFlyoutEntries } from '@/app/workspace/[workspaceId]/components/folders/flyout-entries'

function folder(id: string, name: string, parentId: string | null, updatedAt: string) {
  return { id, name, parentId, updatedAt: new Date(updatedAt) }
}

function item(id: string, name: string, folderId: string | null, updatedAt: string) {
  return { id, name, folderId, updatedAt: new Date(updatedAt) }
}

const NONE: ReadonlySet<string> = new Set()

function build(
  folders: ReturnType<typeof folder>[],
  items: ReturnType<typeof item>[],
  pinned?: { folders?: ReadonlySet<string>; items?: ReadonlySet<string> }
) {
  return buildFlyoutEntries({
    folders,
    items,
    pinnedFolderIds: pinned?.folders ?? NONE,
    pinnedItemIds: pinned?.items ?? NONE,
    hrefForItem: (row) => `/x/${row.id}`,
  })
}

describe('buildFlyoutEntries', () => {
  it('orders folders and items together, most-recently-updated first', () => {
    const entries = build(
      [
        folder('f1', 'Older folder', null, '2026-01-01'),
        folder('f2', 'Newest', null, '2026-03-01'),
      ],
      [item('i1', 'Middle', null, '2026-02-01')]
    )

    expect(entries.map((entry) => entry.id)).toEqual(['f2', 'i1', 'f1'])
  })

  it('floats pinned rows above newer unpinned ones, matching the list pages', () => {
    const entries = build(
      [folder('f1', 'Folder', null, '2026-03-01')],
      [item('i1', 'Pinned', null, '2026-01-01'), item('i2', 'Newest', null, '2026-04-01')],
      { items: new Set(['i1']) }
    )

    expect(entries.map((entry) => entry.id)).toEqual(['i1', 'i2', 'f1'])
  })

  it('breaks ties on name', () => {
    const entries = build(
      [],
      [
        item('b', 'Beta', null, '2026-01-01'),
        item('c', 'Alpha', null, '2026-01-01'),
        item('a', 'Gamma', null, '2026-01-01'),
      ]
    )

    expect(entries.map((entry) => entry.id)).toEqual(['c', 'b', 'a'])
  })

  it('nests items under their folder and links each one', () => {
    const entries = build(
      [folder('f1', 'Reports', null, '2026-01-01'), folder('f2', 'Q1', 'f1', '2026-01-02')],
      [item('i1', 'Revenue', 'f2', '2026-01-03')]
    )

    expect(entries).toEqual([
      {
        kind: 'folder',
        id: 'f1',
        name: 'Reports',
        pinned: false,
        children: [
          {
            kind: 'folder',
            id: 'f2',
            name: 'Q1',
            pinned: false,
            children: [{ kind: 'item', id: 'i1', name: 'Revenue', pinned: false, href: '/x/i1' }],
          },
        ],
      },
    ])
  })

  it('hoists a folder and an item whose parent folder is gone to the root', () => {
    const entries = build(
      [folder('f1', 'Orphan', 'archived-folder', '2026-01-02')],
      [item('i1', 'Loose', 'archived-folder', '2026-01-01')]
    )

    expect(entries.map((entry) => entry.id)).toEqual(['f1', 'i1'])
    expect(entries[0]).toMatchObject({ kind: 'folder', children: [] })
  })

  it('drops folders reachable only through a parent cycle instead of descending it', () => {
    const entries = build(
      [
        folder('a', 'A', 'b', '2026-01-01'),
        folder('b', 'B', 'a', '2026-01-01'),
        folder('root', 'Root', null, '2026-01-01'),
      ],
      []
    )

    expect(entries.map((entry) => entry.id)).toEqual(['root'])
  })

  it('accepts serialized date strings and sorts undated rows last', () => {
    const entries = buildFlyoutEntries({
      folders: [],
      items: [
        { id: 'i1', name: 'Undated', folderId: null, updatedAt: 'not-a-date' },
        { id: 'i2', name: 'Dated', folderId: null, updatedAt: '2026-01-01T00:00:00.000Z' },
      ],
      pinnedFolderIds: NONE,
      pinnedItemIds: NONE,
      hrefForItem: (row) => `/x/${row.id}`,
    })

    expect(entries.map((entry) => entry.id)).toEqual(['i2', 'i1'])
  })

  it('treats a missing folderId as the root', () => {
    const entries = buildFlyoutEntries({
      folders: [],
      items: [{ id: 'i1', name: 'Rootless', updatedAt: new Date('2026-01-01') }],
      pinnedFolderIds: NONE,
      pinnedItemIds: NONE,
      hrefForItem: (row) => `/x/${row.id}`,
    })

    expect(entries).toEqual([
      { kind: 'item', id: 'i1', name: 'Rootless', pinned: false, href: '/x/i1' },
    ])
  })

  it('keeps each nesting level ordered independently, not just the root', () => {
    const entries = build(
      [folder('f1', 'Root folder', null, '2026-05-01')],
      [
        item('deep-old', 'Deep old', 'f1', '2026-01-01'),
        item('deep-new', 'Deep new', 'f1', '2026-04-01'),
        item('root-mid', 'Root mid', null, '2026-03-01'),
      ]
    )

    expect(entries.map((entry) => entry.id)).toEqual(['f1', 'root-mid'])
    const nested = entries[0]
    expect(nested.kind).toBe('folder')
    if (nested.kind !== 'folder') throw new Error('expected a folder')
    expect(nested.children.map((child) => child.id)).toEqual(['deep-new', 'deep-old'])
  })

  it('preserves the full depth of the folder chain', () => {
    const entries = build(
      [
        folder('a', 'A', null, '2026-01-01'),
        folder('b', 'B', 'a', '2026-01-01'),
        folder('c', 'C', 'b', '2026-01-01'),
      ],
      [item('leaf', 'Leaf', 'c', '2026-01-01')]
    )

    const depth = (rows: ReturnType<typeof build>): number => {
      const nested = rows.find((row) => row.kind === 'folder')
      return nested && nested.kind === 'folder' ? 1 + depth(nested.children) : 0
    }
    expect(depth(entries)).toBe(3)
  })

  it('keeps an empty folder in the tree rather than dropping it', () => {
    const entries = build(
      [folder('empty', 'Nothing here', null, '2026-01-01')],
      [item('i1', 'Loose', null, '2026-01-02')]
    )

    expect(entries.map((entry) => entry.id)).toEqual(['i1', 'empty'])
    expect(entries[1]).toMatchObject({ kind: 'folder', children: [] })
  })

  it('marks pinned folders and pinned resources so the ordering is legible', () => {
    const entries = build(
      [folder('f1', 'Folder', null, '2026-01-01')],
      [item('i1', 'Table', null, '2026-01-02')],
      { folders: new Set(['f1']), items: new Set(['i1']) }
    )

    expect(entries.map((entry) => entry.pinned)).toEqual([true, true])
  })
})
