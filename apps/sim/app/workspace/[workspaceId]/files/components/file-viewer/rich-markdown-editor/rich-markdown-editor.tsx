'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { cn, toast } from '@sim/emcn'
import type { JSONContent } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { EditorContent, useEditor } from '@tiptap/react'
import { useRouter } from 'next/navigation'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { extractEmbeddedFileRef } from '@/lib/uploads/utils/embedded-image-ref'
import { useUploadWorkspaceFile } from '@/hooks/queries/workspace-files'
import type { SaveStatus } from '@/hooks/use-autosave'
import { useFileContentSource } from '@/hooks/use-file-content-source'
import { PreviewLoadingFrame } from '../preview-shared'
import { useEditableFileContent } from '../use-editable-file-content'
import { createMarkdownEditorExtensions } from './editor-extensions'
import { findHeadingPos } from './heading-anchors'
import {
  extractImageFiles,
  extractImgSrcs,
  findHostedImageAttrs,
  shouldSkipFileUpload,
} from './image-paste'
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
import { TableBubbleMenu } from './menus/table-menu'
import { normalizeMarkdownContent } from './normalize-content'
import { isRoundTripSafe } from './round-trip-safety'
import '@sim/emcn/components/code/code.css'
import './rich-markdown-editor.css'

const EXTENSIONS = createMarkdownEditorExtensions({
  placeholder: "Write something, or press '/' for commands…",
  embeds: true,
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
  onSaveStatusChange?: (status: SaveStatus, retry?: () => Promise<void>) => void
  saveRef?: React.MutableRefObject<(() => Promise<void>) | null>
  discardRef?: React.MutableRefObject<(() => void) | null>
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
  /** Disable the `@` tag-insertion menu (existing tags still render). Defaults off — the file editor keeps tagging. */
  disableTagging?: boolean
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
  discardRef,
  streamingContent,
  isAgentEditing,
  streamIsIncremental,
  disableStreamingAutoScroll = false,
  previewContextKey,
  disableTagging,
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
    discardRef,
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
      disableTagging={disableTagging}
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
  disableTagging?: boolean
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
  disableTagging,
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
  const source = useFileContentSource()

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

  /**
   * A same-page copy/drag of an already-hosted `<img>` carries the clipboard/dataTransfer `html`'s
   * *display* src (`source.resolveImageSrc`'s rewrite), not the real persisted one — inserting a node
   * built straight from that html would bake the display-only URL into the document, breaking public
   * share/export/referenced-by-doc tracking for it (they only recognize the persisted shape).
   * `findHostedImageAttrs` finds the real, already-present node with a matching resolved src instead,
   * so the clone gets the exact real `src` (and every other attribute — width, href, title…) rather
   * than a re-derived guess. Returns `false` (falls through to a normal upload) if no match is found,
   * which is always correct, just occasionally a redundant upload — unlike blindly trusting the html.
   */
  const cloneHostedImageRef = useRef<(imgSrcs: string[], at: number) => boolean>(() => false)
  cloneHostedImageRef.current = (imgSrcs, at) => {
    const editor = editorInstanceRef.current
    if (!editor) return false
    const matchedAttrs = findHostedImageAttrs(editor.state.doc, imgSrcs, source.resolveImageSrc)
    if (!matchedAttrs) return false
    const safePosition = Math.min(at, editor.state.doc.content.size)
    try {
      editor.chain().insertContentAt(safePosition, { type: 'image', attrs: matchedAttrs }).run()
      return true
    } catch {
      return false
    }
  }

  const editor = useEditor({
    extensions: EXTENSIONS,
    editable: isEditable,
    enablePasteRules: false,
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
      /**
       * Inserts pasted image files at the caret. A same-page copy of an already-hosted `<img>` (e.g.
       * Cmd+C after clicking it to select it) makes the browser add BOTH `text/html` (the real node,
       * with its real hosted `src`) AND a synthesized image `File` to the clipboard — indistinguishable
       * from a genuine external image paste by `clipboardData` files/items alone. When the HTML sibling
       * already names one of our own hosted files, look up the matching node already in this doc and
       * clone ITS real attrs (see `cloneHostedImageRef`) instead of re-uploading the pasted bytes as a
       * brand-new, distinct file — letting the editor's DEFAULT html-based paste do that clone instead
       * would persist the html's display-layer src rather than the real one. Only applied when exactly
       * one image file is offered: a genuinely mixed paste (the hosted image plus a separate new one)
       * must still upload the new file rather than have the whole paste diverted by this bypass.
       */
      handlePaste: (view, event) => {
        if (!view.editable) return false
        const images = extractImageFiles(event.clipboardData)
        const html = event.clipboardData?.getData('text/html') ?? ''
        if (shouldSkipFileUpload(images, html, (src) => extractEmbeddedFileRef(src) !== null)) {
          const cloned = cloneHostedImageRef.current(
            extractImgSrcs(html),
            view.state.selection.from
          )
          if (cloned) {
            event.preventDefault()
            return true
          }
        }
        if (images.length === 0) return false
        event.preventDefault()
        void insertImagesRef.current(images, view.state.selection.from)
        return true
      },
      /**
       * Inserts dropped image files at the drop point. Any other file drop (e.g. a PDF) is swallowed so
       * the browser doesn't navigate away from the editor; internal text drags carry no files and fall
       * through to the default behavior.
       *
       * Dragging an existing image node to reorder it is also an internal drag, but the browser's
       * native drag-and-drop synthesizes an image `File` into `event.dataTransfer` for a dragged `<img>`
       * (the same mechanism that lets a user drag a web image out to their desktop) — indistinguishable
       * from a real external drop by `dataTransfer` files/items alone. When the accompanying `text/html`
       * shows it's a same-page drag of an already-hosted image, bail out and let ProseMirror's own
       * default move logic run — it relocates the actual existing node object (`dragging.node`), never
       * re-parsing html, so (unlike the paste case above) there's no display-vs-persisted src risk here.
       * Checked from `html`, not `view.dragging`, so a stale `dragging` flag (ProseMirror clears it up
       * to ~50ms late via `dragend` when a prior internal drag was dropped outside this view) can never
       * suppress the plain-file swallow guard below for an unrelated drop that happens to land in that
       * window — this only reacts to what THIS specific drop's `html` actually contains.
       */
      handleDrop: (view, event) => {
        if (!view.editable) return false
        const images = extractImageFiles(event.dataTransfer)
        const html = event.dataTransfer?.getData('text/html') ?? ''
        if (shouldSkipFileUpload(images, html, (src) => extractEmbeddedFileRef(src) !== null)) {
          return false
        }
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

  useEditorMentions(editor, workspaceId, { navigable: true, disableTagging })

  const wasStreamingRef = useRef(streamingAtMountRef.current)

  const pendingStreamBodyRef = useRef<string | null>(null)
  const streamRafRef = useRef<number | null>(null)
  const lastStreamParseAtRef = useRef(0)
  useEffect(() => {
    if (!editor) return
    const syncEditorBody = (body: string) => {
      if (body === lastSyncedBodyRef.current) return
      lastSyncedBodyRef.current = body
      editor.commands.setContent(parseMarkdownToDoc(body), {
        contentType: 'json',
        emitUpdate: false,
      })
    }
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
      syncEditorBody(splitFrontmatter(content).body)
      // `setContent` maps any pre-existing selection onto the new doc rather than clearing it — a
      // select-all survives as "select everything," permanently painting every divider/image with the
      // `rich-leaf-in-selection` decoration (keymap.ts) until the user clicks elsewhere. This must run
      // on every settle regardless of whether `setContent` ran just above: the last streaming tick
      // already syncs `lastSyncedBodyRef` to the final body before settle, so `body` usually already
      // equals it here — collapsing only inside that `if` would skip the common streamed-content case
      // entirely. `setTextSelection` (not `.focus()`) so this never steals DOM focus from whatever the
      // user is doing outside the editor.
      editor.commands.setTextSelection(editor.state.doc.content.size)
      editor.setEditable(canEdit && settledRef.current.verdict)
      if (isInitialSettle && autoFocus) editor.commands.focus('end')
      return
    }
    syncEditorBody(splitFrontmatter(content).body)
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
      {editor && <TableBubbleMenu editor={editor} scrollContainerRef={containerRef} />}
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
