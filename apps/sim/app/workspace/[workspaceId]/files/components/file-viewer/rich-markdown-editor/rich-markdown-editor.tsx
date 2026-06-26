'use client'

import { memo, useEffect, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { EditorContent, useEditor } from '@tiptap/react'
import { useRouter } from 'next/navigation'
import { toast } from '@/components/emcn'
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
import { useEditorMentions } from './mention'
import { EditorBubbleMenu } from './menus/bubble-menu'
import { LinkHoverCard } from './menus/link-hover-card'
import { normalizeMarkdownContent } from './normalize-content'
import { isRoundTripSafe } from './round-trip-safety'
import '@/components/emcn/components/code/code.css'
import './rich-markdown-editor.css'

const EXTENSIONS = createMarkdownEditorExtensions({
  placeholder: "Write something, or press '/' for commands…",
})

/** Throttle the per-frame full re-parse above this body size so a large streaming file can't saturate the main thread. */
const STREAM_REPARSE_THROTTLE_THRESHOLD = 40_000
const STREAM_REPARSE_THROTTLE_MS = 120

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
  /**
   * True when the stream delivers complete full-file snapshots (an `append`/`patch` edit built on the
   * existing file) rather than a from-scratch rebuild (`create`/`update`). Incremental snapshots are
   * applied live; a rebuild is only revealed while it extends what's shown (see the streaming tick).
   */
  streamIsIncremental?: boolean
  disableStreamingAutoScroll?: boolean
  previewContextKey?: string
}

/** Inline WYSIWYG markdown editor: agent output streams in read-only, then the same instance becomes editable on settle. */
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
  streamIsIncremental,
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
    normalizeBaseline: normalizeMarkdownContent,
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
      key={previewContextKey ? `${file.id}:${previewContextKey}` : file.id}
      file={file}
      workspaceId={workspaceId}
      content={content}
      isStreaming={isStreamInteractionLocked}
      canEdit={canEdit}
      autoFocus={autoFocus}
      streamIsIncremental={streamIsIncremental}
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
  /** See {@link RichMarkdownEditorProps.streamIsIncremental}. */
  streamIsIncremental?: boolean
  disableStreamingAutoScroll?: boolean
  onChange: (markdown: string) => void
  onSaveShortcut: () => Promise<void>
}

interface SettledContent {
  frontmatter: string
  verdict: boolean
}

/** Locks the round-trip verdict + frontmatter once; a round-trip-unsafe doc (raw HTML, footnotes, >256KB) opens read-only. */
function lockSettled(content: string): SettledContent {
  return { frontmatter: splitFrontmatter(content).frontmatter, verdict: isRoundTripSafe(content) }
}

/** The single TipTap editor: read-only while streaming, editable on settle; frontmatter is held aside and re-applied. */
export function LoadedRichMarkdownEditor({
  file,
  workspaceId,
  content,
  isStreaming,
  canEdit,
  autoFocus,
  streamIsIncremental,
  disableStreamingAutoScroll,
  onChange,
  onSaveShortcut,
}: LoadedRichMarkdownEditorProps) {
  /** Whether this editor mounted mid-stream — if so it starts empty and syncs streamed chunks until settle. */
  const streamingAtMountRef = useRef(isStreaming)

  /** Verdict + frontmatter, locked once (at mount if settled, else on settle); null reads as read-only. */
  const settledRef = useRef<SettledContent | null>(null)
  if (!streamingAtMountRef.current && settledRef.current === null) {
    settledRef.current = lockSettled(content)
  }
  const isEditable = canEdit && !isStreaming && (settledRef.current?.verdict ?? false)

  /** Seed the doc once via lazy init — chunked parse is linear vs the editor's ~O(n²) whole-body markdown parse. */
  const [initialContent] = useState<JSONContent | string>(() =>
    streamingAtMountRef.current ? '' : parseMarkdownToDoc(splitFrontmatter(content).body)
  )
  /**
   * The body currently shown in the editor: seeded from a settled mount, updated on local edits (via
   * onUpdate) and on each streamed sync. Incremental edits (append/patch) stream complete snapshots and
   * always apply; a from-scratch rebuild (create/update) only applies while it still extends this, so a
   * rewrite holds the current content instead of collapsing to a partial result.
   */
  const lastSyncedBodyRef = useRef<string | null>(
    streamingAtMountRef.current ? null : splitFrontmatter(content).body
  )
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onSaveShortcutRef = useRef(onSaveShortcut)
  onSaveShortcutRef.current = onSaveShortcut
  /**
   * Read in the RAF tick so an already-scheduled tick still sees the latest edit kind (it can change
   * between sessions within one turn, e.g. an append followed by a rewrite).
   */
  const streamIsIncrementalRef = useRef(streamIsIncremental)
  streamIsIncrementalRef.current = streamIsIncremental
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router

  const containerRef = useRef<HTMLDivElement>(null)
  const uploadFile = useUploadWorkspaceFile()
  const editorInstanceRef = useRef<Editor | null>(null)

  /**
   * The `/Image` slash command opens this hidden picker; `pendingImagePosRef` holds the caret position
   * captured when the command ran, so the upload inserts where `/Image` was typed.
   */
  const imageInputRef = useRef<HTMLInputElement>(null)
  const pendingImagePosRef = useRef<number | null>(null)

  /**
   * Upload then insert each image at `at` (paste caret / drop point), sequentially; held in a ref so
   * handlers reach the latest. A persistent (`duration: 0`) progress toast shows per image during the
   * upload and is dismissed once it settles, when the upload hook's own "Uploaded"/"Failed" toast takes over.
   */
  const insertImagesRef = useRef<(images: File[], at: number) => Promise<void>>(() =>
    Promise.resolve()
  )
  insertImagesRef.current = async (images, at) => {
    let position = at
    for (const image of images) {
      const uploadingToastId = toast.info(`Uploading "${image.name}"…`, { duration: 0 })
      const result = await uploadFile
        .mutateAsync({ workspaceId, file: image, folderId: file.folderId ?? null })
        .catch(() => null)
      toast.dismiss(uploadingToastId)
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
      attributes: { class: 'rich-markdown-prose', 'data-owned-shortcuts': 'Mod+K' },
      handleKeyDown: (_view, event) => {
        const isSaveShortcut = (event.metaKey || event.ctrlKey) && event.key?.toLowerCase() === 's'
        if (!isSaveShortcut) return false
        event.preventDefault()
        void onSaveShortcutRef.current()
        return true
      },
      /**
       * Follows a clicked link. While editing a modifier is required (a plain click places the cursor);
       * read-only follows directly. A same-page anchor (`[x](#slug)`) scrolls to the matching heading; a
       * same-origin in-app path navigates within the SPA (same tab); everything else opens a new tab.
       */
      handleClick: (view, _pos, event) => {
        const href = (event.target as HTMLElement | null)?.closest('a')?.getAttribute('href')
        if (!href) return false
        if (view.editable && !(event.metaKey || event.ctrlKey)) return false
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
      /**
       * Inserts dropped image files at the drop point. Any other file drop (e.g. a PDF) is swallowed so
       * the browser doesn't navigate away from the editor; internal text drags carry no files and fall
       * through to the default behavior.
       */
      handleDrop: (view, event) => {
        if (!view.editable) return false
        const images = extractImageFiles(event.dataTransfer)
        if (images.length > 0) {
          event.preventDefault()
          const dropPos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
          void insertImagesRef.current(images, dropPos ?? view.state.selection.from)
          return true
        }
        if (event.dataTransfer?.files.length) {
          event.preventDefault()
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor }) => {
      const md = postProcessSerializedMarkdown(editor.getMarkdown())
      lastSyncedBodyRef.current = md
      onChangeRef.current(applyFrontmatter(settledRef.current?.frontmatter ?? '', md))
    },
  })
  editorInstanceRef.current = editor

  /**
   * Wire the `/Image` slash command to the hidden picker (per-editor storage, since the extension set is
   * shared across instances). Reads only refs, so the handler stays stable across the editor's life.
   */
  useEffect(() => {
    if (!editor) return
    editor.storage.slashCommand.insertImage = (at: number) => {
      pendingImagePosRef.current = at
      imageInputRef.current?.click()
    }
    return () => {
      editor.storage.slashCommand.insertImage = null
    }
  }, [editor])

  useEditorMentions(editor, workspaceId, { navigable: true })

  const wasStreamingRef = useRef(streamingAtMountRef.current)

  const pendingStreamBodyRef = useRef<string | null>(null)
  const streamRafRef = useRef<number | null>(null)
  const lastStreamParseAtRef = useRef(0)
  useEffect(() => {
    if (!editor) return
    if (isStreaming) {
      wasStreamingRef.current = true
      if (editor.isEditable) editor.setEditable(false)
      const body = splitFrontmatter(content).body
      if (body === lastSyncedBodyRef.current) return
      pendingStreamBodyRef.current = body
      if (streamRafRef.current !== null) return
      /** Self-re-arming tick: parse the latest pending body, but throttle a large one (cheap re-check, no parse) until due. */
      const tick = () => {
        const pending = pendingStreamBodyRef.current
        if (pending === null || pending === lastSyncedBodyRef.current) {
          streamRafRef.current = null
          return
        }
        const shownBody = lastSyncedBodyRef.current
        const extendsShown = shownBody === null || pending.startsWith(shownBody)
        if (!streamIsIncrementalRef.current && !extendsShown) {
          streamRafRef.current = null
          return
        }
        if (
          pending.length > STREAM_REPARSE_THROTTLE_THRESHOLD &&
          performance.now() - lastStreamParseAtRef.current < STREAM_REPARSE_THROTTLE_MS
        ) {
          streamRafRef.current = requestAnimationFrame(tick)
          return
        }
        streamRafRef.current = null
        lastSyncedBodyRef.current = pending
        lastStreamParseAtRef.current = performance.now()
        const el = containerRef.current
        const pinnedToBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 80 : false
        if (editor.isEditable) editor.setEditable(false)
        editor.commands.setContent(parseMarkdownToDoc(pending), {
          contentType: 'json',
          emitUpdate: false,
        })
        if (!disableStreamingAutoScroll && el && pinnedToBottom) el.scrollTop = el.scrollHeight
      }
      streamRafRef.current = requestAnimationFrame(tick)
      return
    }
    if (streamRafRef.current !== null) {
      cancelAnimationFrame(streamRafRef.current)
      streamRafRef.current = null
    }
    /** Settle: re-lock the verdict + frontmatter on the freshly-settled content (every stream→settle, not just the first). */
    const isInitialSettle = settledRef.current === null
    if (isInitialSettle || wasStreamingRef.current) {
      wasStreamingRef.current = false
      settledRef.current = lockSettled(content)
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
      {editor && <EditorBubbleMenu editor={editor} scrollContainerRef={containerRef} />}
      {editor && <LinkHoverCard editor={editor} />}
      <input
        ref={imageInputRef}
        type='file'
        accept='image/*'
        multiple
        hidden
        onChange={(event) => {
          const input = event.currentTarget
          const images = Array.from(input.files ?? []).filter((f) => f.type.startsWith('image/'))
          const at =
            pendingImagePosRef.current ?? editorInstanceRef.current?.state.selection.from ?? 0
          pendingImagePosRef.current = null
          input.value = ''
          if (images.length > 0) void insertImagesRef.current(images, at)
        }}
      />
      <EditorContent
        editor={editor}
        className='mx-auto flex w-full max-w-[48rem] flex-1 flex-col px-8 py-6 selection:bg-[var(--selection-bg)] selection:text-[var(--text-primary)] dark:selection:bg-[var(--selection-dark)] dark:selection:text-white'
      />
    </div>
  )
}
