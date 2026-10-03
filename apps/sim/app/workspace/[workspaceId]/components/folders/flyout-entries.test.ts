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
})
