import type { TableUndoAction } from '@/stores/table/types'

type RenameColumnUndoAction = Extract<TableUndoAction, { type: 'rename-column' }>

interface PersistColumnRenameOptions {
  columnId: string
  oldName: string
  newName: string
  persist: () => Promise<unknown>
  pushUndo: (action: RenameColumnUndoAction) => void
  onRenamed: () => void
}

export async function persistColumnRename({
  columnId,
  oldName,
  newName,
  persist,
  pushUndo,
  onRenamed,
}: PersistColumnRenameOptions): Promise<void> {
  await persist()
  pushUndo({ type: 'rename-column', oldName, newName, columnId })
  onRenamed()
}

interface InlineRenameSession {
  isSaving: boolean
  startRename: (id: string, currentName: string) => void
}

export function tryStartColumnRename(
  session: InlineRenameSession,
  columnId: string,
  currentName: string
): boolean {
  if (session.isSaving) return false
  session.startRename(columnId, currentName)
  return true
}
