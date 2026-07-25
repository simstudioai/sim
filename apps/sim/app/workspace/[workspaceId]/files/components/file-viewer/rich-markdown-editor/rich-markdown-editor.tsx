'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { cn, toast } from '@sim/emcn'
import type { JoinFileDocError } from '@sim/realtime-protocol/file-doc'
import type { Extensions, JSONContent } from '@tiptap/core'
import { Fragment, Slice } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import { dropPoint } from '@tiptap/pm/transform'
import type { Editor } from '@tiptap/react'
import { EditorContent, useEditor } from '@tiptap/react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/auth/auth-client'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { extractEmbeddedFileRef } from '@/lib/uploads/utils/embedded-image-ref'
import { useUploadWorkspaceFile } from '@/hooks/queries/workspace-files'
import type { SaveStatus } from '@/hooks/use-autosave'
import { useFileContentSource } from '@/hooks/use-file-content-source'
import { PreviewLoadingFrame } from '../preview-shared'
import { useEditableFileContent } from '../use-editable-file-content'
import { useFileDocCollaboration } from './collaboration/use-file-doc-collaboration'
import { createMarkdownEditorExtensions } from './editor-extensions'
import { findHeadingPos } from './heading-anchors'
import {
  extractImageFiles,
  extractImgSrcs,
  findHostedImageAttrs,
  htmlReferencesSrc,
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

const PLACEHOLDER = "Write something, or press '/' for commands…"

const EXTENSIONS = createMarkdownEditorExtensions({
  placeholder: PLACEHOLDER,
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
  const { data: session, isPending: isSessionPending } = useSession()
  const userId = session?.user?.id ?? ''
  const userName = session?.user?.name?.trim() || 'Collaborator'

  /**
   * Autosave gate for the collaborative path: the child reports `false` while its
   * shared document is still syncing/seeding and `true` once it is safe to persist
   * the markdown mirror — so an empty or partially-synced doc can never overwrite
   * the real file. `true` for non-collaborative files (never gated).
   */
  const [collabReady, setCollabReady] = useState(true)

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
    canAutosave: collabReady,
  })

  // Wait for the session too: the child decides collaboration ONCE at mount from
  // `userId`, so mounting before the session resolves would latch collaboration off
  // for a cold-loaded file (both users would then solo-save, last-write-wins).
  if (isContentLoading || isSessionPending)
    return <PreviewLoadingFrame className='flex flex-1 flex-col' />

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
      userId={userId}
      userName={userName}
      autoFocus={autoFocus}
      streamIsIncremental={streamIsIncremental}
      disableStreamingAutoScroll={disableStreamingAutoScroll}
      disableTagging={disableTagging}
      onChange={setDraftContent}
      onSaveShortcut={saveImmediately}
      onCollabReadyChange={setCollabReady}
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
  /** Current user id + display name, for the collaborative caret identity. */
  userId: string
  userName: string
  autoFocus?: boolean
  /** See {@link RichMarkdownEditorProps.streamIsIncremental}. */
  streamIsIncremental?: boolean
  disableStreamingAutoScroll?: boolean
  disableTagging?: boolean
  onChange: (markdown: string) => void
  onSaveShortcut: () => Promise<void>
  /** Reports whether the collaborative document is synced+seeded (autosave gate). */
  onCollabReadyChange: (ready: boolean) => void
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
  userId,
  userName,
  autoFocus,
  streamIsIncremental,
  disableStreamingAutoScroll,
  disableTagging,
  onChange,
  onSaveShortcut,
  onCollabReadyChange,
}: LoadedRichMarkdownEditorProps) {
  /** Whether this editor mounted mid-stream — if so it starts empty and syncs streamed chunks until settle. */
  const streamingAtMountRef = useRef(isStreaming)

  /** Verdict + frontmatter, locked once (at mount if settled, else on settle); null reads as read-only. */
  const settledRef = useRef<SettledContent | null>(null)
  if (!streamingAtMountRef.current && settledRef.current === null) {
    settledRef.current = lockSettled(content)
  }
  /**
   * Collaboration is decided ONCE at mount (TipTap fixes the extension set at
   * editor creation, so it cannot turn on later): only an editable, round-trip-safe,
   * non-streaming workspace document with a known user. All inputs are available
   * synchronously at mount (`settledRef` is set just above), so this is decided
   * once via `useState`-init and never changes.
   */
  const [collaborationEnabled] = useState(
    () =>
      canEdit &&
      !streamingAtMountRef.current &&
      (settledRef.current?.verdict ?? false) &&
      Boolean(userId) &&
      (file.storageContext ?? 'workspace') === 'workspace'
  )
  /**
   * Whether the collaborative document is safe to edit + persist: synced and seeded,
   * or degraded to writable after a recoverable collaboration failure. Starts
   * `false` for a collaborative document — so the editor is read-only and autosave
   * gated until the shared content has arrived (a user must not type into an empty,
   * unsynced doc, which the seed would then discard) — and `true` for a local one.
   */
  const [collabReady, setCollabReady] = useState(!collaborationEnabled)
  const isEditable =
    canEdit && !isStreaming && (settledRef.current?.verdict ?? false) && collabReady

  const collaboration = useFileDocCollaboration({
    fileId: file.id,
    userId,
    userName,
    enabled: collaborationEnabled,
  })

  /**
   * Initial editor content. When collaborating, the Y.Doc is the source of truth —
   * start empty and let the seed handshake fill it (below); otherwise seed from the
   * parsed markdown (chunked parse is linear vs the editor's ~O(n²) whole-body parse).
   */
  const [initialContent] = useState<JSONContent | string>(() =>
    streamingAtMountRef.current || collaborationEnabled
      ? ''
      : parseMarkdownToDoc(splitFrontmatter(content).body)
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
  const resolveImageSrcRef = useRef(source.resolveImageSrc)
  resolveImageSrcRef.current = source.resolveImageSrc

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

  /**
   * Extensions: the shared module set for the local path, or a per-instance set
   * carrying this document's Collaboration + CollaborationCaret. Built once (collab
   * is decided at mount), since `useEditor` fixes the extension set at creation.
   */
  const [extensions] = useState<Extensions>(() =>
    collaboration
      ? createMarkdownEditorExtensions({
          placeholder: PLACEHOLDER,
          embeds: true,
          collaboration: {
            doc: collaboration.doc,
            awareness: collaboration.awareness,
            user: collaboration.user,
          },
        })
      : EXTENSIONS
  )

  const editor = useEditor({
    extensions,
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
       * Drag-REORDER of an image node is the deceptive case. TipTap's node-view dragstart bypasses
       * ProseMirror's own drag serialization entirely — no PM `text/html`, no `view.dragging` — but it
       * DOES NodeSelect the dragged image; what the drop carries instead is the browser's native
       * enrichment for a dragged `<img>`: an image `File` plus `text/html` whose src is the ABSOLUTE
       * rendered URL of that exact node. So when the drop's html points at the currently-selected image
       * node ({@link htmlReferencesSrc}), this drop IS that node being moved, and the move must be
       * performed here: uploading would duplicate it (the original never moves), and falling through to
       * ProseMirror is no better — with `view.dragging` unset its default drop PARSES the html into a
       * copy (persisting the display-layer src, which share/export tracking don't recognize) and never
       * deletes the original. The gate accepts at most one file (not exactly one): some drag transports
       * (e.g. CDP-driven input) carry the html alone, and a genuinely external drop can never reference
       * the currently-selected node's own resolved src.
       *
       * The move itself is the same shape as ProseMirror's own: compute the drop point on the
       * pre-delete doc, delete the source, map the insert position through that delete. A null
       * `dropPoint` (no valid insertion point) is a handled no-op — the node stays put, still
       * selected — never a raw-position fallback, which `tr.insert` could throw on (PM's own null
       * fallback is only safe because it uses the forgiving `replaceRangeWith`).
       *
       * PM-serialized drags (a text selection spanning an image, dragged from a textblock) still reach
       * the `shouldSkipFileUpload` bail below: PM set `view.dragging` for those itself, so its default
       * move logic is correct there.
       */
      handleDrop: (view, event) => {
        if (!view.editable) return false
        const images = extractImageFiles(event.dataTransfer)
        const html = event.dataTransfer?.getData('text/html') ?? ''
        const { selection } = view.state
        if (
          images.length <= 1 &&
          selection instanceof NodeSelection &&
          selection.node.type.name === 'image' &&
          htmlReferencesSrc(html, resolveImageSrcRef.current(selection.node.attrs.src))
        ) {
          event.preventDefault()
          const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
          if (!coords) return true
          const node = selection.node
          const tr = view.state.tr
          const insertPos = dropPoint(
            view.state.doc,
            coords.pos,
            new Slice(Fragment.from(node), 0, 0)
          )
          if (insertPos === null) return true
          tr.delete(selection.from, selection.to)
          const mapped = tr.mapping.map(insertPos)
          tr.insert(mapped, node)
          tr.setSelection(NodeSelection.create(tr.doc, mapped))
          view.dispatch(tr.scrollIntoView())
          return true
        }
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
   * The loaded markdown to seed the shared doc from, held by pointer so the parse
   * runs once at seed time rather than every render.
   */
  const seedContentRef = useRef(content)
  seedContentRef.current = content

  /**
   * The collaborative document lifecycle. In one effect because the three concerns
   * are one state machine keyed off the same provider events:
   * - **seed** the doc from the loaded markdown when this client is elected and
   *   synced (content + `initialContentLoaded` flag in ONE Yjs transaction, so a
   *   re-election can never duplicate content — the relay's exactly-once contract);
   * - **gate** the parent's autosave until the doc is synced AND seeded, so an
   *   empty/still-syncing doc can never overwrite the real file's markdown mirror;
   * - **degrade** on a fatal join: seed the loaded content so it is shown, and — for
   *   a NON-permission failure (the user can still save) — mark it writable so the
   *   file stays editable locally (edits persist through the mirror, only live sync
   *   is off). A permission denial stays read-only (the save would 403 too).
   *
   * `ready` (synced+seeded, or degraded-writable) gates BOTH the editor's editability
   * (a user must never type into an empty/unsynced doc) and the parent's autosave.
   * Non-collaborative documents are never gated. `provider.shouldSeed` is latched, so
   * a SEED_REQUEST that arrived before this subscription is not missed.
   */
  useEffect(() => {
    const setReady = (ready: boolean) => {
      setCollabReady(ready)
      onCollabReadyChange(ready)
    }
    if (!collaboration) {
      setReady(true)
      return
    }
    const { provider, doc } = collaboration
    if (!provider || !editor) {
      setReady(false)
      return
    }
    const config = doc.getMap('config')
    let degraded = false

    const seedFromLoaded = () => {
      if (config.get('initialContentLoaded') === true) return
      doc.transact(() => {
        editor.commands.setContent(
          parseMarkdownToDoc(splitFrontmatter(seedContentRef.current).body),
          { contentType: 'json', emitUpdate: false }
        )
        config.set('initialContentLoaded', true)
      })
    }
    const report = () =>
      setReady(degraded || (provider.synced && config.get('initialContentLoaded') === true))
    const onProgress = () => {
      if (provider.shouldSeed && provider.synced) seedFromLoaded()
      report()
    }
    const onJoinError = (error: JoinFileDocError) => {
      if (error.retryable !== false) return
      // Show the loaded content, but only mark it writable when the failure isn't a
      // permission denial — a denied user can't save either, so it stays read-only.
      seedFromLoaded()
      if (error.code !== 'ACCESS_DENIED') degraded = true
      report()
    }

    provider.on('seed-request', onProgress)
    provider.on('synced', onProgress)
    provider.on('join-error', onJoinError)
    config.observe(report)
    onProgress()

    return () => {
      provider.off('seed-request', onProgress)
      provider.off('synced', onProgress)
      provider.off('join-error', onJoinError)
      config.unobserve(report)
      onCollabReadyChange(true)
    }
  }, [collaboration, editor, onCollabReadyChange, setCollabReady])

  /**
   * Apply editability reactively for the collaborative steady state: `useEditor`'s
   * `editable` is only the initial value, and the streaming/settle effect (which owns
   * editability while and just after a stream) is skipped otherwise — so re-apply
   * here when collaboration readiness flips the editor from read-only to editable.
   */
  useEffect(() => {
    if (!editor || !collaborationEnabled || isStreaming) return
    if (editor.isEditable !== isEditable) editor.setEditable(isEditable)
  }, [editor, collaborationEnabled, isStreaming, isEditable])

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
    // When collaborating, the Y.Doc is the source of truth for at-rest content, so
    // skip this manual reconcile loop in steady state. But an agent stream that starts
    // after a collaborative open must still run — both while streaming (`isStreaming`)
    // and through its settle (`wasStreamingRef`, true until the settle branch consumes
    // it) — so the agent's output is shown, flows into the shared doc via `setContent`,
    // and the editor is re-enabled on settle. Collab and streaming are mutually
    // exclusive at mount, so this only affects a stream begun after a collaborative open.
    if (collaborationEnabled && !isStreaming && !wasStreamingRef.current) return
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
  }, [
    editor,
    content,
    isStreaming,
    canEdit,
    autoFocus,
    disableStreamingAutoScroll,
    collaborationEnabled,
  ])

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
