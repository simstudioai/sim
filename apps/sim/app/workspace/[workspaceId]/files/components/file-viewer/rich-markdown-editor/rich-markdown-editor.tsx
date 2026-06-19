'use client'

import { memo, useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { EditorContent, useEditor } from '@tiptap/react'
import { cn } from '@/lib/core/utils/cn'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { useUploadWorkspaceFile } from '@/hooks/queries/workspace-files'
import type { SaveStatus } from '@/hooks/use-autosave'
import { PreviewLoadingFrame } from '../preview-shared'
import { useEditableFileContent } from '../use-editable-file-content'
import { createMarkdownEditorExtensions } from './extensions'
import { extractImageFiles } from './image-paste'
import {
  applyFrontmatter,
  normalizeLinkHref,
  postProcessSerializedMarkdown,
  splitFrontmatter,
} from './markdown-fidelity'
import { EditorBubbleMenu } from './menus/bubble-menu'
import { isRoundTripSafe } from './round-trip-safety'
import '@/components/emcn/components/code/code.css'
import './rich-markdown-editor.css'

const EXTENSIONS = createMarkdownEditorExtensions({
  placeholder: "Write something, or press '/' for commands…",
})

interface RichMarkdownEditorProps {
  file: WorkspaceFileRecord
  workspaceId: string
  canEdit: boolean
  autoFocus?: boolean
  onDirtyChange?: (isDirty: boolean) => void
  onSaveStatusChange?: (status: SaveStatus) => void
  saveRef?: React.MutableRefObject<(() => Promise<void>) | null>
  streamingContent?: string
  disableStreamingAutoScroll?: boolean
  previewContextKey?: string
}

/**
 * Inline WYSIWYG markdown editor (TipTap/ProseMirror) for markdown files — a single editing surface
 * (markdown transformed inline as you type), no raw/preview split and no separate streaming preview.
 * Owns the file lifecycle through a single {@link useEditableFileContent} engine, and the TipTap
 * editor is the ONLY thing the user ever sees: while agent output streams in it renders that content
 * read-only (synced per chunk), then the same editor instance becomes editable once the stream
 * settles — so the stream→edit transition has no renderer swap or flash.
 *
 * The editor is keyed by file id (+ streaming context). A file opened outside a stream uses the plain
 * create-time initial-content model (no sync). See {@link LoadedRichMarkdownEditor} for the
 * read-only-stream → editable hand-off.
 */
export const RichMarkdownEditor = memo(function RichMarkdownEditor({
  file,
  workspaceId,
  canEdit,
  autoFocus,
  onDirtyChange,
  onSaveStatusChange,
  saveRef,
  streamingContent,
  disableStreamingAutoScroll = false,
  previewContextKey,
}: RichMarkdownEditorProps) {
  const {
    content,
    setDraftContent,
    isStreamInteractionLocked,
    isContentLoading,
    hasContentError,
    saveImmediately,
  } = useEditableFileContent({
    file,
    workspaceId,
    canEdit,
    streamingContent,
    onDirtyChange,
    onSaveStatusChange,
    saveRef,
  })

  if (isContentLoading) return <PreviewLoadingFrame className='flex flex-1 flex-col' />

  if (hasContentError) {
    return (
      <div className='flex flex-1 items-center justify-center'>
        <p className='text-[var(--text-muted)] text-small'>Failed to load file content</p>
      </div>
    )
  }

  return (
    <LoadedRichMarkdownEditor
      // Remount on a new streaming context so the stream/settle state is re-established fresh.
      key={previewContextKey ? `${file.id}:${previewContextKey}` : file.id}
      file={file}
      workspaceId={workspaceId}
      content={content}
      isStreaming={isStreamInteractionLocked}
      canEdit={canEdit}
      autoFocus={autoFocus}
      disableStreamingAutoScroll={disableStreamingAutoScroll}
      onChange={setDraftContent}
      onSaveShortcut={saveImmediately}
    />
  )
})

interface LoadedRichMarkdownEditorProps {
  file: WorkspaceFileRecord
  workspaceId: string
  /** The live content from the engine — grows as the agent streams, then settles to the saved doc. */
  content: string
  /** True while agent output is streaming in: the editor renders it read-only and syncs each chunk. */
  isStreaming: boolean
  canEdit: boolean
  autoFocus?: boolean
  disableStreamingAutoScroll?: boolean
  onChange: (markdown: string) => void
  onSaveShortcut: () => Promise<void>
}

interface SettledContent {
  frontmatter: string
  verdict: boolean
}

/**
 * Lock the round-trip verdict + frontmatter on the content the editor "opens" with — once, at mount
 * for a settled file or at the moment a stream settles. A round-trip-unsafe document (raw HTML,
 * footnotes, >128KB, …) opens read-only so an edit can't corrupt it; a safe one stays editable. Never
 * re-derived: a dirty document is safe by construction (the editor only emits safe markdown), so
 * flipping editability off mid-edit would only strand edits.
 */
function lockSettled(content: string): SettledContent {
  return { frontmatter: splitFrontmatter(content).frontmatter, verdict: isRoundTripSafe(content) }
}

/**
 * The single TipTap editor for a markdown file — the only surface the user ever sees. While agent
 * output streams in ({@link isStreaming}) it renders that content read-only and re-syncs each chunk;
 * when the stream settles it locks the round-trip verdict + frontmatter on the final content and
 * hands control to the user. A file opened outside a stream skips straight to that editable state via
 * the initial-content model (no imperative sync). Frontmatter is held aside and re-applied on every
 * change, so the editor only ever round-trips the body.
 */
export function LoadedRichMarkdownEditor({
  file,
  workspaceId,
  content,
  isStreaming,
  canEdit,
  autoFocus,
  disableStreamingAutoScroll,
  onChange,
  onSaveShortcut,
}: LoadedRichMarkdownEditorProps) {
  // Whether this editor mounted mid-stream. If so it starts empty + read-only and syncs the streamed
  // content until the stream settles; otherwise it uses the plain create-time initial-content model.
  const streamingAtMountRef = useRef(isStreaming)

  // The verdict + frontmatter locked via {@link lockSettled} — at mount for a settled file, or at the
  // moment a stream settles (in the effect below). Null until then; reads default to read-only.
  const settledRef = useRef<SettledContent | null>(null)
  if (!streamingAtMountRef.current && settledRef.current === null) {
    settledRef.current = lockSettled(content)
  }
  const isEditable = canEdit && !isStreaming && (settledRef.current?.verdict ?? false)

  // The body that seeds the editor at create time. Empty when streaming — the sync effect pushes the
  // streamed body in via setContent (this ref is never written again).
  const initialBodyRef = useRef(streamingAtMountRef.current ? '' : splitFrontmatter(content).body)
  // The frontmatter re-attached on every change. Empty until the content settles (the editor never
  // displays frontmatter, so a streamed doc simply shows its body). Re-derived in the settle effect
  // on each stream→settle, so a repeat stream re-attaches the settled doc's frontmatter, never a
  // stale one.
  const frontmatterRef = useRef(settledRef.current?.frontmatter ?? '')
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onSaveShortcutRef = useRef(onSaveShortcut)
  onSaveShortcutRef.current = onSaveShortcut

  const containerRef = useRef<HTMLDivElement>(null)
  const uploadFile = useUploadWorkspaceFile()
  const editorInstanceRef = useRef<Editor | null>(null)

  /**
   * Upload each image to the workspace, then insert it at `at` (paste = caret, drop = cursor under
   * the pointer). Sequential so multiple images stack in order; the upload hook surfaces its own
   * success/error toasts, so a failed upload is skipped without interrupting the rest. Held in a ref
   * (reassigned each render) so the once-built `editorProps` handlers always reach the latest values.
   */
  const insertImagesRef = useRef<(images: File[], at: number) => Promise<void>>(() =>
    Promise.resolve()
  )
  insertImagesRef.current = async (images, at) => {
    let position = at
    for (const image of images) {
      const result = await uploadFile
        .mutateAsync({ workspaceId, file: image, folderId: file.folderId ?? null })
        .catch(() => null)
      const editor = editorInstanceRef.current
      if (!result || !editor) continue
      const safePosition = Math.min(position, editor.state.doc.content.size)
      try {
        editor
          .chain()
          .insertContentAt(safePosition, {
            type: 'image',
            attrs: { src: result.file.url, alt: image.name },
          })
          .run()
        position = editor.state.selection.to
      } catch {
        position = editor.state.doc.content.size
      }
    }
  }

  const editor = useEditor({
    extensions: EXTENSIONS,
    editable: isEditable,
    autofocus: streamingAtMountRef.current ? false : autoFocus ? 'end' : false,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    content: initialBodyRef.current,
    contentType: 'markdown',
    editorProps: {
      attributes: { class: 'rich-markdown-prose' },
      handleKeyDown: (_view, event) => {
        const isSaveShortcut = (event.metaKey || event.ctrlKey) && event.key?.toLowerCase() === 's'
        if (!isSaveShortcut) return false
        event.preventDefault()
        void onSaveShortcutRef.current()
        return true
      },
      handleClick: (_view, _pos, event) => {
        if (!(event.metaKey || event.ctrlKey)) return false
        const href = (event.target as HTMLElement | null)?.closest('a')?.getAttribute('href')
        if (!href) return false
        const normalized = normalizeLinkHref(href)
        if (!normalized) return false
        window.open(normalized, '_blank', 'noopener,noreferrer')
        return true
      },
      handlePaste: (view, event) => {
        if (!view.editable) return false
        const images = extractImageFiles(event.clipboardData)
        if (images.length === 0) return false
        event.preventDefault()
        void insertImagesRef.current(images, view.state.selection.from)
        return true
      },
      handleDrop: (view, event) => {
        if (!view.editable) return false
        const images = extractImageFiles(event.dataTransfer)
        if (images.length === 0) return false
        event.preventDefault()
        const dropPos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        void insertImagesRef.current(images, dropPos ?? view.state.selection.from)
        return true
      },
    },
    onUpdate: ({ editor }) => {
      const md = postProcessSerializedMarkdown(editor.getMarkdown())
      onChangeRef.current(applyFrontmatter(frontmatterRef.current, md))
    },
  })
  editorInstanceRef.current = editor

  // Stream content into the editor (read-only) until it settles, then lock the verdict + frontmatter
  // and hand control to the user. After the hand-off, only `canEdit` changes touch the editor — the
  // editor owns the content, so there is no sync that could clobber a user edit.
  const lastSyncedBodyRef = useRef<string | null>(null)
  // Whether the editor was streaming on the previous effect run, so the settle branch can re-lock on
  // each stream→settle transition. An agent can edit the same file more than once within a chat, and
  // `previewContextKey` (the chat id) keeps this instance mounted across those edits — so the verdict
  // + frontmatter must be re-derived per stream, not frozen on the first settled snapshot.
  const wasStreamingRef = useRef(streamingAtMountRef.current)
  useEffect(() => {
    if (!editor) return
    if (isStreaming) {
      wasStreamingRef.current = true
      const body = splitFrontmatter(content).body
      if (body === lastSyncedBodyRef.current) return
      lastSyncedBodyRef.current = body
      const el = containerRef.current
      const pinnedToBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 80 : false
      editor.setEditable(false)
      editor.commands.setContent(body, { contentType: 'markdown', emitUpdate: false })
      if (!disableStreamingAutoScroll && el && pinnedToBottom) el.scrollTop = el.scrollHeight
      return
    }
    // Settle: lock the verdict + frontmatter on the freshly-settled content. Re-lock on the initial
    // settle and on every later stream→settle, so a repeat agent edit gates editability + frontmatter
    // on the NEW content rather than a stale pre-stream snapshot. User edits never re-derive (they
    // keep `isStreaming`/`wasStreamingRef` false), preserving the don't-strand-edits rule.
    const isInitialSettle = settledRef.current === null
    if (isInitialSettle || wasStreamingRef.current) {
      wasStreamingRef.current = false
      settledRef.current = lockSettled(content)
      frontmatterRef.current = settledRef.current.frontmatter
      // Re-seed only if the settled body differs from the last streamed chunk — it usually doesn't,
      // and an extra setContent would needlessly rebuild the doc and drop selection/scroll.
      const body = splitFrontmatter(content).body
      if (body !== lastSyncedBodyRef.current) {
        lastSyncedBodyRef.current = body
        editor.commands.setContent(body, { contentType: 'markdown', emitUpdate: false })
      }
      editor.setEditable(canEdit && settledRef.current.verdict)
      if (isInitialSettle && autoFocus) editor.commands.focus('end')
      return
    }
    if (settledRef.current) editor.setEditable(canEdit && settledRef.current.verdict)
  }, [editor, content, isStreaming, canEdit, autoFocus, disableStreamingAutoScroll])

  return (
    <div
      ref={containerRef}
      className={cn('flex flex-1 flex-col overflow-y-auto', isEditable && 'cursor-text')}
    >
      {editor && <EditorBubbleMenu editor={editor} />}
      <EditorContent
        editor={editor}
        className='mx-auto flex w-full max-w-[48rem] flex-1 flex-col px-8 py-6 selection:bg-[var(--selection-bg)] selection:text-[var(--text-primary)] dark:selection:bg-[var(--selection-dark)] dark:selection:text-white'
      />
    </div>
  )
}
