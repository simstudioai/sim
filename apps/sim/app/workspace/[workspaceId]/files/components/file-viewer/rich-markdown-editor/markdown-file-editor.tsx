'use client'

import { useRef } from 'react'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { useWorkspaceFileContent } from '@/hooks/queries/workspace-files'
import type { SaveStatus } from '@/hooks/use-autosave'
import { PreviewLoadingFrame } from '../preview-shared'
import { TextEditor } from '../text-editor'
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
}

/**
 * Chooses the editing surface for a markdown file. Almost every file renders in the inline
 * {@link RichMarkdownEditor}, but a small set of constructs can't survive the markdown
 * round-trip losslessly (a linked image, inline code containing a backtick). For those we fall
 * back to the raw {@link TextEditor} so the file is never silently corrupted on save.
 *
 * The gate peeks the (React Query-cached) content before mounting either editor, so the chosen
 * surface re-reads the same content instantly and only one autosave engine is ever live.
 *
 * The decision is made once — on the first loaded content — and locked for the lifetime of the
 * mount (the component is keyed by file id, so it remounts per file). This keeps the editor from
 * ever swapping out from under the user on a background refetch (window focus, post-save), and
 * keeps the round-trip probe off the hot path. Anything typed in the rich editor is inherently
 * round-trip-safe, so the lock can never cause silent data loss.
 */
export function MarkdownFileEditor({
  file,
  workspaceId,
  canEdit,
  autoFocus,
  onDirtyChange,
  onSaveStatusChange,
  saveRef,
}: MarkdownFileEditorProps) {
  const { data, isLoading, error } = useWorkspaceFileContent(workspaceId, file.id, file.key)

  const decisionRef = useRef<boolean | null>(null)
  if (decisionRef.current === null && data !== undefined) {
    decisionRef.current = isRoundTripSafe(data)
  }

  if (decisionRef.current === null && isLoading) {
    return <PreviewLoadingFrame className='flex flex-1 flex-col' />
  }

  // Fall back to the raw editor when the content can't round-trip losslessly, or the fetch failed
  // (a later retry-success resolves `data` and the gate decides normally).
  if (decisionRef.current === false || (decisionRef.current === null && error)) {
    return (
      <TextEditor
        file={file}
        workspaceId={workspaceId}
        canEdit={canEdit}
        previewMode='editor'
        autoFocus={autoFocus}
        onDirtyChange={onDirtyChange}
        onSaveStatusChange={onSaveStatusChange}
        saveRef={saveRef}
        disableStreamingAutoScroll={false}
      />
    )
  }

  return (
    <RichMarkdownEditor
      file={file}
      workspaceId={workspaceId}
      canEdit={canEdit}
      autoFocus={autoFocus}
      onDirtyChange={onDirtyChange}
      onSaveStatusChange={onSaveStatusChange}
      saveRef={saveRef}
    />
  )
}
