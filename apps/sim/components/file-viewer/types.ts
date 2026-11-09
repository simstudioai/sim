import type { MutableRefObject } from 'react'
import type { FileDownloadSource } from '@/lib/uploads/client/download'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import type { SaveStatus } from '@/hooks/use-autosave'
import type { ChatContext } from '@/stores/panel'

/** How a text file shows: its source, its source beside its preview, or its preview alone. */
export type PreviewMode = 'editor' | 'split' | 'preview'

/** What an agent writing into a file hands its viewer while the write runs. */
export type FileStreamProps = Pick<
  FileEditingProps,
  | 'streamingContent'
  | 'isAgentEditing'
  | 'streamIsIncremental'
  | 'streamOperation'
  | 'disableStreamingAutoScroll'
  | 'previewContextKey'
>

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
  /** Hands a selection to Chat; without it the view offers no "Add to Chat". */
  onAddToChat?: (context: ChatContext) => void
  /** Content an agent is writing into the file, shown as it arrives and locked against edits. */
  streamingContent?: string
  /** An agent is editing the file: the view stays read-only until it settles. */
  isAgentEditing?: boolean
  /** Whether each streamed frame extends the last, so a shorter frame is held rather than shown. */
  streamIsIncremental?: boolean
  /** The agent's file operation, such as `append` or `patch`, for how its frames apply. */
  streamOperation?: string
  /** Keeps the reader's scroll position instead of following streamed content to its end. */
  disableStreamingAutoScroll?: boolean
  /** Scopes the view's state to one preview context, such as one chat's view of the file. */
  previewContextKey?: string
}
