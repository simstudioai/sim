'use client'

import { useRef } from 'react'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { useWorkspaceFileContent } from '@/hooks/queries/workspace-files'
import type { SaveStatus } from '@/hooks/use-autosave'
import { PreviewLoadingFrame } from '../preview-shared'
import type { StreamingMode } from '../text-editor-state'
import { RichMarkdownEditor } from './rich-markdown-editor'
import { isRoundTripSafe } from './round-trip-safety'

interface MarkdownFileEditorProps {
  file: WorkspaceFileRecord
  workspaceId: string
  canEdit: boolean
  autoFocus?: boolean
  onDirtyChange?: (isDirty: boolean) => void
  onSaveStatusChange?: (status: SaveStatus) => void
  saveRef?: React.MutableRefObject<(() => Promise<void>) | null>
  streamingContent?: string
  streamingMode?: StreamingMode
  disableStreamingAutoScroll?: boolean
  previewContextKey?: string
}

/**
 * Renders a markdown file in the inline {@link RichMarkdownEditor} — the single surface for
 * markdown everywhere. A small tail of constructs can't survive the markdown round-trip losslessly
 * (raw HTML, footnotes, linked images, >128KB); editing those would corrupt them, so the gate marks
 * them read-only (autosave never fires) while still rendering them in the same rich editor. There is
 * no separate raw/Monaco editor.
 *
 * The round-trip decision is made once, on the first SETTLED content, and locked for the mount
 * (keyed by file id). It is deferred while streaming — partial content would misclassify, and the
 * editor renders the live stream read-only regardless of the eventual verdict.
 */
export function MarkdownFileEditor({
  file,
  workspaceId,
  canEdit,
  autoFocus,
  onDirtyChange,
  onSaveStatusChange,
  saveRef,
  streamingContent,
  streamingMode,
  disableStreamingAutoScroll,
  previewContextKey,
}: MarkdownFileEditorProps) {
  const { data, isLoading } = useWorkspaceFileContent(workspaceId, file.id, file.key)

  const isStreaming = streamingContent !== undefined

  const decisionRef = useRef<boolean | null>(null)
  if (decisionRef.current === null && !isStreaming && data !== undefined) {
    decisionRef.current = isRoundTripSafe(data)
  }

  if (decisionRef.current === null && isLoading && !isStreaming) {
    return <PreviewLoadingFrame className='flex flex-1 flex-col' />
  }

  return (
    <RichMarkdownEditor
      file={file}
      workspaceId={workspaceId}
      canEdit={canEdit && decisionRef.current !== false}
      autoFocus={autoFocus}
      onDirtyChange={onDirtyChange}
      onSaveStatusChange={onSaveStatusChange}
      saveRef={saveRef}
      streamingContent={streamingContent}
      streamingMode={streamingMode}
      disableStreamingAutoScroll={disableStreamingAutoScroll}
      previewContextKey={previewContextKey}
    />
  )
}
