import type { folder } from '@sim/db/schema'
import {
  type FolderPathIndex,
  isFolderPathEffectivelyLocked,
  toFolderPathView,
} from '@/lib/folders/paths'

type FolderRow = typeof folder.$inferSelect

export function toV2PathFolder(
  row: FolderRow,
  index: FolderPathIndex<FolderRow>,
  includeLocked: boolean
) {
  const path = index.pathById.get(row.id)
  if (!path) throw new Error('Folder path index is missing a listed folder')
  const base = toFolderPathView(row, path)
  return includeLocked ? { ...base, locked: isFolderPathEffectivelyLocked(index, row.id) } : base
}
