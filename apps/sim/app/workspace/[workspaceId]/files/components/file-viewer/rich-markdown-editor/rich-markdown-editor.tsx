'use client'

import { memo, useEffect, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { EditorContent, useEditor } from '@tiptap/react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/core/utils/cn'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { useUploadWorkspaceFile } from '@/hooks/queries/workspace-files'
import type { SaveStatus } from '@/hooks/use-autosave'
import { PreviewLoadingFrame } from '../preview-shared'
import { useEditableFileContent } from '../use-editable-file-content'
import { createMarkdownEditorExtensions } from './extensions'
import { findHeadingPos } from './heading-anchors'
import { extractImageFiles } from './image-paste'
import {
  applyFrontmatter,
  normalizeLinkHref,
  postProcessSerializedMarkdown,
  splitFrontmatter,
} from './markdown-fidelity'
import { parseMarkdownToDoc } from './markdown-parse'
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
  isAgentEditing?: boolean
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
  isAgentEditing,
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
    isAgentEditing,
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
  // Whether this editor mounted mid-stream — if so it starts empty and syncs streamed chunks until settle.
  const streamingAtMountRef = useRef(isStreaming)

  // Verdict + frontmatter locked once via {@link lockSettled} (at mount when settled, else when the
  // stream settles below); null until then reads as read-only.
  const settledRef = useRef<SettledContent | null>(null)
  if (!streamingAtMountRef.current && settledRef.current === null) {
    settledRef.current = lockSettled(content)
  }
  const isEditable = canEdit && !isStreaming && (settledRef.current?.verdict ?? false)

  // Seed the editor with the chunked-parsed doc (linear vs the editor's ~O(n²) markdown parse), computed
  // once via lazy state init — `useRef(parseMarkdownToDoc(...))` would re-parse the whole body every render.
  const [initialContent] = useState<JSONContent | string>(() =>
    streamingAtMountRef.current ? '' : parseMarkdownToDoc(splitFrontmatter(content).body)
  )
  // Frontmatter held aside and re-attached on every change (the editor never shows it); re-derived per
  // stream→settle in the settle effect, so a repeat stream uses the new doc's frontmatter, not a stale one.
  const frontmatterRef = useRef(settledRef.current?.frontmatter ?? '')
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onSaveShortcutRef = useRef(onSaveShortcut)
  onSaveShortcutRef.current = onSaveShortcut
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router

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
    content: initialContent,
    editorProps: {
      attributes: { class: 'rich-markdown-prose' },
      handleKeyDown: (_view, event) => {
        const isSaveShortcut = (event.metaKey || event.ctrlKey) && event.key?.toLowerCase() === 's'
        if (!isSaveShortcut) return false
        event.preventDefault()
        void onSaveShortcutRef.current()
        return true
      },
      handleClick: (view, _pos, event) => {
        const href = (event.target as HTMLElement | null)?.closest('a')?.getAttribute('href')
        if (!href) return false
        // Editing: require a modifier so a plain click can place the cursor. Read-only (a reader, e.g.
        // the public share page): a plain click follows the link.
        if (view.editable && !(event.metaKey || event.ctrlKey)) return false
        // Same-page anchor (`[x](#slug)`): scroll to the matching heading instead of opening a tab,
        // restoring the table-of-contents links that worked via rehype-slug in the old preview.
        if (href.startsWith('#')) {
          const pos = findHeadingPos(view.state.doc, href.slice(1))
          if (pos < 0) return false
          ;(view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          })
          return true
        }
        const normalized = normalizeLinkHref(href)
        if (!normalized) return false
        // A same-origin in-app path navigates within the SPA (same tab) — unless the reader
        // modifier-clicked for a new tab. External URLs always open a new tab.
        if (
          !(event.metaKey || event.ctrlKey) &&
          normalized.startsWith('/') &&
          !normalized.startsWith('//')
        ) {
          routerRef.current.push(normalized)
          return true
        }
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

  // Stream content in read-only until it settles, then lock the verdict + frontmatter and hand off; after
  // that only `canEdit` touches the editor (it owns the content, so no sync can clobber a user edit).
  const lastSyncedBodyRef = useRef<string | null>(null)
  // Tracks whether the previous run was streaming so the settle branch re-locks on every stream→settle:
  // one instance can receive several agent edits in a chat (kept mounted by `previewContextKey`), so the
  // verdict/frontmatter must follow the latest stream, not the first settled snapshot.
  const wasStreamingRef = useRef(streamingAtMountRef.current)
  // Coalesce streamed chunks to one re-parse per animation frame — a fast agent emits many per frame and
  // each would re-parse the whole accumulating body. Read-only while streaming, so only the latest renders.
  const pendingStreamBodyRef = useRef<string | null>(null)
  const streamRafRef = useRef<number | null>(null)
  useEffect(() => {
    if (!editor) return
    if (isStreaming) {
      wasStreamingRef.current = true
      const body = splitFrontmatter(content).body
      if (body === lastSyncedBodyRef.current) return
      pendingStreamBodyRef.current = body
      if (streamRafRef.current !== null) return
      streamRafRef.current = requestAnimationFrame(() => {
        streamRafRef.current = null
        const pending = pendingStreamBodyRef.current
        if (pending === null || pending === lastSyncedBodyRef.current) return
        lastSyncedBodyRef.current = pending
        const el = containerRef.current
        const pinnedToBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 80 : false
        editor.setEditable(false)
        editor.commands.setContent(parseMarkdownToDoc(pending), {
          contentType: 'json',
          emitUpdate: false,
        })
        if (!disableStreamingAutoScroll && el && pinnedToBottom) el.scrollTop = el.scrollHeight
      })
      return
    }
    // Drop a frame scheduled just before settle so it can't land afterward and clobber the final content.
    if (streamRafRef.current !== null) {
      cancelAnimationFrame(streamRafRef.current)
      streamRafRef.current = null
    }
    // Settle: re-lock the verdict + frontmatter on the freshly-settled content — on the first settle and
    // every later stream→settle, so a repeat agent edit gates on the NEW content, not a stale snapshot.
    // User edits never reach here (`isStreaming`/`wasStreamingRef` stay false), preserving don't-strand-edits.
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
        editor.commands.setContent(parseMarkdownToDoc(body), {
          contentType: 'json',
          emitUpdate: false,
        })
      }
      editor.setEditable(canEdit && settledRef.current.verdict)
      if (isInitialSettle && autoFocus) editor.commands.focus('end')
      return
    }
    if (settledRef.current) editor.setEditable(canEdit && settledRef.current.verdict)
  }, [editor, content, isStreaming, canEdit, autoFocus, disableStreamingAutoScroll])

  useEffect(
    () => () => {
      if (streamRafRef.current !== null) cancelAnimationFrame(streamRafRef.current)
    },
    []
  )

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
