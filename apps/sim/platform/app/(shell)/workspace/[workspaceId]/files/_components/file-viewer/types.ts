import type { MutableRefObject } from 'react'
import type { FileDownloadSource, SaveStatus, WorkspaceFileRecord } from '@/platform/lib/data/files'

/** How a text file shows: its source, its source beside its preview, or its preview alone. */
export type PreviewMode = 'editor' | 'split' | 'preview'

/** What an editable view of a file reports to, and takes commands from, the page around it. */
export interface FileEditingProps {
  file: WorkspaceFileRecord
  workspaceId: string
  canEdit: boolean
  autoFocus?: boolean
  onDirtyChange?: (isDirty: boolean) => void
  /** `retry` is the instance's own immediate save, offered beside an `error`. */
  onSaveStatusChange?: (status: SaveStatus, retry?: () => Promise<void>) => void
  saveRef?: MutableRefObject<(() => Promise<void>) | null>
  /** The live draft, so a download takes what is on screen rather than the last save. */
  downloadSourceRef?: MutableRefObject<FileDownloadSource | null>
  discardRef?: MutableRefObject<(() => void) | null>
}
