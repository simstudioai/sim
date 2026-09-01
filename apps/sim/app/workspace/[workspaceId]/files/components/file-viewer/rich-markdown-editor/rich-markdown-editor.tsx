'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { cn, toast } from '@sim/emcn'
import { FILE_DOC_SEED, type JoinFileDocError } from '@sim/realtime-protocol/file-doc'
import { formatPasteLimit, PASTE_LIMITS } from '@sim/utils/paste'
import type { Extensions, JSONContent } from '@tiptap/core'
import { isChangeOrigin } from '@tiptap/extension-collaboration'
import type { Editor } from '@tiptap/react'
import { EditorContent, useEditor } from '@tiptap/react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/auth/auth-client'
import {
  buildFileSelectionLabel,
  truncateSelectionText,
} from '@/lib/copilot/chat/selection-context'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { extractEmbeddedFileRef, extractImgSrcs } from '@/lib/uploads/utils/embedded-image-ref'
import { FindBar } from '@/app/workspace/[workspaceId]/components'
import { isUntitledName } from '@/app/workspace/[workspaceId]/files/untitled-title'
import { useUploadWorkspaceFile } from '@/hooks/queries/workspace-files'
import { useAddToChat } from '@/hooks/use-add-to-chat'
import type { SaveStatus } from '@/hooks/use-autosave'
import { useFileContentSource } from '@/hooks/use-file-content-source'
import type { ChatContext } from '@/stores/panel'
import { PreviewLoadingFrame } from '../preview-shared'
import { useEditableFileContent } from '../use-editable-file-content'
import { useSelectionCopyBridge } from '../use-selection-copy-bridge'
import {
  announceAgentApplying,
  clearAgentApplying,
  isAgentStreamLeader,
} from './collaboration/agent-stream-leader'
import {
  type AgentStreamSession,
  applyAgentStreamFrame,
  beginAgentStream,
  endAgentStream,
} from './collaboration/apply-streamed-markdown'
import { nextCollabReadiness } from './collaboration/readiness'
import { useFileDocCollaboration } from './collaboration/use-file-doc-collaboration'
import { createMarkdownEditorExtensions } from './editor-extensions'
import { useMarkdownFind } from './find'
import { findHeadingPos } from './heading-anchors'
import { moveDraggedImageNode } from './image-drag-move'
import { extractImageFiles, findHostedImageAttrs, shouldSkipFileUpload } from './image-paste'
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
import { firstHeadingTitle } from './title-heading'
import '@sim/emcn/components/code/code.css'
import '../document-table.css'
import './rich-markdown-editor.css'

const PLACEHOLDER = "Write something, or press '/' for commands…"

const EXTENSIONS = createMarkdownEditorExtensions({
  placeholder: PLACEHOLDER,
  embeds: true,
})

/** Throttle the per-frame full re-parse above this body size so a large streaming file can't saturate the main thread. */
const STREAM_REPARSE_THROTTLE_THRESHOLD = 40_000
const STREAM_REPARSE_THROTTLE_MS = 120

/** Debounce before naming a still-untitled file after its leading heading, so it fires once typing settles. */
const DERIVE_TITLE_DEBOUNCE_MS = 600

function warnRichMarkdownPasteLimit() {
  toast.warning('Paste is too large for rich-text editing', {
    description: `Keep this document under ${formatPasteLimit(PASTE_LIMITS.RICH_MARKDOWN_BYTES)}, or import the content as a file and open it read-only.`,
  })
}

/**
 * The editor's reading column — the centered, padded surface both the live editor and the read-only
 * {@link ReadOnlyPlaceholder} render into, so the two are geometrically identical and the placeholder →
 * live swap never reflows. Shared as one constant to keep them in lockstep.
 */
const EDITOR_SURFACE_CLASS =
  'mx-auto flex w-full max-w-[48rem] flex-1 flex-col px-8 py-6 selection:bg-[var(--selection-bg)] selection:text-[var(--text-primary)] dark:selection:bg-[var(--selection-dark)] dark:selection:text-white'

/**
 * Read-only editor that renders the already-fetched markdown while a collaborative doc waits for its
 * server seed, so the pane shows content instantly instead of blocking blank on the socket round-trip
 * (the seed IS the same markdown, so the swap on `collabReady` is seamless). It shares the live
 * editor's extension set ({@link EXTENSIONS}) — and therefore its node views and decoration plugins
 * (syntax highlighting, mention chips, images, mermaid diagrams, media embeds) — so the content is
 * pixel-identical to the live editor and the swap neither repaints nor reflows. It carries no
 * Collaboration extension, Y.Doc, or awareness, so it structurally cannot write to the shared document
 * (a client seed would duplicate it), and `editable={false}` disables every editing affordance. Mounted
 * only while the placeholder shows, so no second editor lingers once the live one takes over.
 */
interface ReadOnlyPlaceholderProps {
  content: JSONContent
}

function ReadOnlyPlaceholder({ content }: ReadOnlyPlaceholderProps) {
  const editor = useEditor({
    extensions: EXTENSIONS,
    editable: false,
    // Render synchronously on first paint (safe — this surface is client-only, never SSR'd) so the
    // placeholder appears instantly like the static HTML it replaced, instead of blanking for a frame
    // while the editor mounts.
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    content,
    editorProps: { attributes: { class: 'rich-markdown-nodes rich-markdown-prose' } },
  })
  return <EditorContent editor={editor} className={EDITOR_SURFACE_CLASS} />
}

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
  /**
   * The agent edit operation driving the stream, when known (`create`/`append`/`update`/`patch`). In the
   * collaborative path it decides only whether to stream mid-flight: an `update` (from-scratch rewrite) is
   * HELD until settle so the open doc doesn't collapse to a partial result, while `append`/`patch`/`create`
   * apply each frame.
   */
  streamOperation?: string
  disableStreamingAutoScroll?: boolean
  previewContextKey?: string
  /** Disable the `@` tag-insertion menu (existing tags still render). Defaults off — the file editor keeps tagging. */
  disableTagging?: boolean
  /**
   * Opt this surface into live collaborative editing (Files page + the embedded chat file preview).
   * Collaboration can coexist with agent streaming: while streaming, the growing content is applied to
   * the shared Y.Doc as minimal CRDT diffs (see {@link applyAgentStreamFrame}) rather than a
   * full-document `setContent`, so the stream stays smooth and every peer sees it live.
   */
  collaborative?: boolean
  /**
   * Called (debounced) with the document's leading-heading text while the file is still untitled, so the
   * caller can name the file after it. Omitted on read-only/non-editable surfaces. See
   * {@link isUntitledName}.
   */
  onDeriveTitleFromHeading?: (headingText: string) => void
  /**
   * Claim Cmd/Ctrl+F for find-in-document. Off by default, because this editor also renders as a
   * preview pane beside something that owns the shortcut itself. Every find surface binds its own
   * listener, so only one may be enabled at a time — see {@link useFindShortcut}.
   */
  enableFind?: boolean
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
  streamOperation,
  disableStreamingAutoScroll = false,
  previewContextKey,
  disableTagging,
  collaborative = false,
  onDeriveTitleFromHeading,
  enableFind = false,
}: RichMarkdownEditorProps) {
  const { data: session, isPending: isSessionPending } = useSession()
  const userId = session?.user?.id ?? ''
  const userName = session?.user?.name?.trim() || 'Collaborator'

  /**
   * Client-autosave gate. For a NON-collaborative file this is `true` (the client owns durability and
   * autosaves the markdown). For a collaborative file it stays `false`: the realtime relay persists the
   * shared document to markdown server-side, so the client must never also autosave — a stale keystroke
   * saving over a server/copilot edit is exactly the clobber the server path closes. The child reports
   * the right value up via `onCollabReadyChange`.
   *
   * Initialize from the `collaborative` prop (NOT unconditionally `true`): a collaborative file must
   * start with autosave OFF, or a save could fire in the window before the child mounts and reports —
   * re-clobbering exactly what this closes. The child turns it on for the non-collaborative fallback.
   */
  const [collabReady, setCollabReady] = useState(!collaborative)

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
      streamOperation={streamOperation}
      disableStreamingAutoScroll={disableStreamingAutoScroll}
      disableTagging={disableTagging}
      collaborative={collaborative}
      onChange={setDraftContent}
      onSaveShortcut={saveImmediately}
      onCollabReadyChange={setCollabReady}
      onDeriveTitleFromHeading={onDeriveTitleFromHeading}
      enableFind={enableFind}
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
  /** See {@link RichMarkdownEditorProps.streamOperation}. */
  streamOperation?: string
  disableStreamingAutoScroll?: boolean
  disableTagging?: boolean
  /** See {@link RichMarkdownEditorProps.collaborative}. */
  collaborative?: boolean
  onChange: (markdown: string) => void
  onSaveShortcut: () => Promise<void>
  /** Reports whether the collaborative document is synced+seeded (autosave gate). */
  onCollabReadyChange: (ready: boolean) => void
  /** See {@link RichMarkdownEditorProps.onDeriveTitleFromHeading}. */
  onDeriveTitleFromHeading?: (headingText: string) => void
  /** See {@link RichMarkdownEditorProps.enableFind}. */
  enableFind: boolean
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
  streamOperation,
  disableStreamingAutoScroll,
  disableTagging,
  collaborative = false,
  onChange,
  onSaveShortcut,
  onCollabReadyChange,
  onDeriveTitleFromHeading,
  enableFind,
}: LoadedRichMarkdownEditorProps) {
  /** Whether this editor mounted mid-stream — if so it starts empty and syncs streamed chunks until settle. */
  const streamingAtMountRef = useRef(isStreaming)

  /** Verdict + frontmatter, locked once (at mount if settled, else on settle); null reads as read-only. */
  const settledRef = useRef<SettledContent | null>(null)
  if (!streamingAtMountRef.current && settledRef.current === null) {
    settledRef.current = lockSettled(content)
  }
  /**
   * Collaboration is decided once at mount from synchronously-available inputs
   * (`settledRef` is set just above) via `useState`-init, and never changes — TipTap
   * fixes the extension set at editor creation, so it cannot turn on later. Enabled on a
   * `collaborative` surface (the Files page or the embedded chat file preview) for an editable,
   * round-trip-safe workspace document with a known user, as long as it is not ALREADY streaming at
   * mount (`!streamingAtMountRef.current`). An agent stream that begins AFTER mount is applied as CRDT
   * diffs into the live doc, so collaboration and streaming coexist (see the streaming effect below).
   */
  const [collaborationEnabled] = useState(
    () =>
      collaborative &&
      canEdit &&
      !streamingAtMountRef.current &&
      (settledRef.current?.verdict ?? false) &&
      Boolean(userId) &&
      (file.storageContext ?? 'workspace') === 'workspace'
  )
  /**
   * Whether the collaborative document is safe to edit + persist: synced and seeded.
   * Starts `false` for a collaborative document — so the editor is read-only and
   * autosave gated until the shared content has arrived (a user must not type into an
   * empty, unsynced doc, which the seed would then discard) — and `true` for a local one.
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
   * start empty and let the server-seeded Yjs sync fill it (below); otherwise seed from the
   * parsed markdown (chunked parse is linear vs the editor's ~O(n²) whole-body parse).
   */
  const [initialContent] = useState<JSONContent | string>(() =>
    streamingAtMountRef.current || collaborationEnabled
      ? ''
      : parseMarkdownToDoc(splitFrontmatter(content).body)
  )
  /**
   * The already-fetched markdown, parsed once, for the read-only {@link ReadOnlyPlaceholder} shown while
   * a collaborative doc waits for its server seed. Held only when collaborating; the local path seeds
   * the live editor directly, so it needs no placeholder.
   */
  const [placeholderContent] = useState<JSONContent | null>(() =>
    collaborationEnabled ? parseMarkdownToDoc(splitFrontmatter(content).body) : null
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
  /**
   * The body the AGENT last applied into the collaborative doc — a dedup guard for the collab streaming
   * tick, so an unchanged frame skips a redundant shadow reconcile/reparse. Written ONLY by the streaming
   * tick (never by `onUpdate`), and reset to `null` on settle for the next stream. It is NOT a string-prefix
   * baseline: the mid-stream hold is decided by operation (`update` waits for settle), not by comparing the
   * raw preview against the editor's canonical markdown.
   */
  const lastStreamedBodyRef = useRef<string | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onSaveShortcutRef = useRef(onSaveShortcut)
  onSaveShortcutRef.current = onSaveShortcut

  /**
   * The frontmatter to re-attach to the body on save. For a collaborative doc it lives in the CRDT
   * (config map, seeded/updated server-side), so a server edit that changes it is reflected rather
   * than reverted by this editor's stale open-time copy; falls back to the locked `settledRef` copy
   * before the seed lands and for non-collaborative documents.
   */
  const resolveSaveFrontmatter = useCallback((): string => {
    const fromDoc = collaboration?.doc
      .getMap(FILE_DOC_SEED.configMap)
      .get(FILE_DOC_SEED.frontmatterKey)
    if (typeof fromDoc === 'string') return fromDoc
    return settledRef.current?.frontmatter ?? ''
  }, [collaboration])

  /**
   * While the file is still unnamed, name it after its leading heading: `onDeriveTitleFromHeading` is
   * called (debounced) so the caller can rename the file, and `fileNameRef` lets the onUpdate handler
   * read the current name without re-subscribing. See {@link isUntitledName}.
   */
  const onDeriveTitleFromHeadingRef = useRef(onDeriveTitleFromHeading)
  onDeriveTitleFromHeadingRef.current = onDeriveTitleFromHeading
  const fileNameRef = useRef(file.name)
  fileNameRef.current = file.name
  const deriveTitleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * Read in the RAF tick so an already-scheduled tick still sees the latest edit kind (it can change
   * between sessions within one turn, e.g. an append followed by a rewrite).
   */
  const streamIsIncrementalRef = useRef(streamIsIncremental)
  streamIsIncrementalRef.current = streamIsIncremental
  const streamOperationRef = useRef(streamOperation)
  streamOperationRef.current = streamOperation
  /** The live agent-stream shadow replica, held for the current stream and freed on settle/unmount. */
  const agentStreamSessionRef = useRef<AgentStreamSession | null>(null)
  /** True once this client has announced candidacy in the agent-stream election for the current stream. */
  const agentAnnouncedRef = useRef(false)
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
          pasteAdmission: {
            maxResultBytes: PASTE_LIMITS.RICH_MARKDOWN_BYTES,
            getCurrentText: () => lastSyncedBodyRef.current ?? '',
            onRejected: warnRichMarkdownPasteLimit,
          },
        })
      : createMarkdownEditorExtensions({
          placeholder: PLACEHOLDER,
          embeds: true,
          pasteAdmission: {
            maxResultBytes: PASTE_LIMITS.RICH_MARKDOWN_BYTES,
            getCurrentText: () => lastSyncedBodyRef.current ?? '',
            onRejected: warnRichMarkdownPasteLimit,
          },
        })
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
      attributes: {
        class: 'rich-markdown-nodes rich-markdown-prose',
        'data-owned-shortcuts': 'Mod+K',
        'data-paste-max-bytes': String(PASTE_LIMITS.RICH_MARKDOWN_BYTES),
        'data-paste-max-html-bytes': String(PASTE_LIMITS.RICH_MARKDOWN_BYTES),
        'data-paste-handles-images': 'true',
      },
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
       * Drag-REORDER of an image node is the deceptive case, and {@link moveDraggedImageNode} owns it —
       * uploading would duplicate the image (the original never moves), and falling through to
       * ProseMirror is no better, since with `view.dragging` unset its default drop PARSES the html into
       * a copy (persisting the display-layer src, which share/export tracking don't recognize) and never
       * deletes the original.
       *
       * PM-serialized drags (a text selection spanning an image, dragged from a textblock) still reach
       * the `shouldSkipFileUpload` bail below: PM set `view.dragging` for those itself, so its default
       * move logic is correct there.
       */
      handleDrop: (view, event) => {
        if (!view.editable) return false
        const images = extractImageFiles(event.dataTransfer)
        const html = event.dataTransfer?.getData('text/html') ?? ''
        if (
          moveDraggedImageNode(view, event, {
            images,
            html,
            resolveSrc: resolveImageSrcRef.current,
          })
        ) {
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
    onUpdate: ({ editor, transaction }) => {
      const md = postProcessSerializedMarkdown(editor.getMarkdown())
      lastSyncedBodyRef.current = md
      onChangeRef.current(applyFrontmatter(resolveSaveFrontmatter(), md))
      // While the file is still untitled, name it after its leading heading once typing settles — but
      // only for the LOCAL user's own edits. `isChangeOrigin` is true for a remote Yjs change (a peer
      // typing); bail BEFORE touching the timer so a remote edit never cancels or reschedules the local
      // user's pending rename (and every client doesn't schedule the same rename from a peer's
      // not-yet-synced heading). It is false for local edits and non-collaborative surfaces.
      if (isChangeOrigin(transaction)) return
      // Local edit: restart the debounce. Clearing first cancels a stale rename if the heading was
      // removed/changed before it fired; the timer re-derives the title from the live doc rather than a
      // value captured now, so it can never name the file after a heading the user has since changed.
      // `editor.isEditable` is the autosave gate (canEdit + settled + collab-ready), so a view-only
      // viewer or the not-yet-editable mount seed never schedules a rename.
      if (deriveTitleTimerRef.current) clearTimeout(deriveTitleTimerRef.current)
      if (
        !editor.isEditable ||
        !isUntitledName(fileNameRef.current) ||
        firstHeadingTitle(editor.state.doc) === null
      )
        return
      deriveTitleTimerRef.current = setTimeout(() => {
        const liveEditor = editorInstanceRef.current
        if (!liveEditor || !liveEditor.isEditable || !isUntitledName(fileNameRef.current)) return
        const title = firstHeadingTitle(liveEditor.state.doc)
        if (title) onDeriveTitleFromHeadingRef.current?.(title)
      }, DERIVE_TITLE_DEBOUNCE_MS)
    },
  })
  editorInstanceRef.current = editor

  useEffect(
    () => () => {
      if (deriveTitleTimerRef.current) clearTimeout(deriveTitleTimerRef.current)
    },
    []
  )

  /**
   * The loaded markdown to seed the shared doc from, held by pointer so the parse
   * runs once at seed time rather than every render.
   */
  const seedContentRef = useRef(content)
  seedContentRef.current = content

  /**
   * The collaborative document lifecycle. In one effect because the three concerns
   * are one state machine keyed off the same provider events:
   * - **observe** readiness: the server seeds the doc authoritatively (content +
   *   `initialContentLoaded` flag in ONE Yjs update), so the client only watches for
   *   synced AND seeded — it never imports content itself on the happy path;
   * - **gate** the parent's autosave until the doc is synced AND seeded, so an
   *   empty/still-syncing doc can never overwrite the real file's markdown mirror;
   * - **fall back** on a fatal join: seed the loaded content so it is SHOWN, but
   *   leave the editor read-only + gated. Every non-retryable failure (auth, access
   *   denied, not found, client-id conflict) either can't save or is moot, so the
   *   safe fallback is a read-only view of the content rather than editable-but-
   *   unsavable — which would silently drop the user's edits.
   *
   * `ready` (synced+seeded) gates BOTH the editor's editability (a user must never
   * type into an empty/unsynced doc) and the parent's autosave. Non-collaborative
   * documents are never gated. The server seeds the doc authoritatively (content + the
   * seed flag arrive together), so the client only observes readiness. `provider.joinError`
   * is latched, so a fatal rejection that fired before this subscription is not missed.
   */
  useEffect(() => {
    /**
     * Readiness is a protocol fact, never a timing guess: the relay attaches a client only once its
     * room holds the whole document (it awaits the shared-stream catch-up and the server seed before
     * answering a join), so a completed sync IS the finished document and revealing on it cannot show
     * an intermediate state. This deliberately does NOT wait for the document to "stop moving" — a
     * quiet-frame gate was tried and it is unsound in both directions: it delays the reveal of a
     * document that was already correct, and it opens mid-flight anyway whenever the updates arrive
     * more than a frame apart (which is what a remote Redis and a long room history produce).
     */
    const setReady = (ready: boolean) => {
      // Child-local: gates editability (a user must never type into an unsynced/unseeded doc).
      setCollabReady(ready)
      // Parent: gates CLIENT autosave. In a collaborative session the relay persists the doc to
      // markdown server-side (debounced + on last-disconnect), so the client must NOT also autosave —
      // a stale keystroke saving over a server/copilot edit is the clobber the server path closes.
      // Only the non-collaborative (solo) path client-autosaves.
      onCollabReadyChange(collaboration ? false : ready)
    }
    if (!collaboration) {
      setReady(true)
      return
    }
    const { provider, doc } = collaboration
    if (!editor) {
      setReady(false)
      return
    }
    const config = doc.getMap(FILE_DOC_SEED.configMap)

    // Readiness LATCHES so a post-seed `synced` flap can't re-gate a new file's agent stream — see
    // {@link nextCollabReadiness} for the full rationale. `offlineSeed` marks a local (read-only) seed.
    let syncedOnce = false
    let offlineSeed = false

    const seedFromLoaded = () => {
      if (config.get(FILE_DOC_SEED.flag) === true) return
      offlineSeed = true
      doc.transact(() => {
        editor.commands.setContent(
          parseMarkdownToDoc(splitFrontmatter(seedContentRef.current).body),
          { contentType: 'json', emitUpdate: false }
        )
        config.set(FILE_DOC_SEED.flag, true)
      })
    }

    if (!provider) {
      setReady(false)
      return
    }

    const report = () => {
      const synced = provider.synced
      const seeded = config.get(FILE_DOC_SEED.flag) === true
      // `joinError` is latched ONLY on the provider's fatal paths (non-retryable rejection, access
      // revocation, readiness deadline), so it is exactly "this document is abandoned".
      const fatal = provider.joinError !== null
      const next = nextCollabReadiness(syncedOnce, { synced, seeded, offlineSeed, fatal })
      syncedOnce = next.syncedOnce
      setReady(next.ready)
    }
    /**
     * Re-report unconditionally, not just when the fallback seeds. A fatal that arrives on an ALREADY
     * seeded doc (access revoked mid-session) leaves `seedFromLoaded` a no-op, so nothing else would
     * fire an observer and the editor would stay editable on a document the provider has abandoned.
     */
    const onJoinError = (error: JoinFileDocError) => {
      if (error.retryable === false) seedFromLoaded()
      report()
    }

    // A server edit that changes ONLY the frontmatter (e.g. copilot) updates the config map but not
    // the body fragment, so TipTap's `onUpdate` never fires and the autosave draft would keep the
    // stale open-time frontmatter — an explicit save could then revert the live change. Re-attach the
    // new frontmatter to the current body and push a fresh draft whenever it changes on its own.
    let lastFrontmatter = config.get(FILE_DOC_SEED.frontmatterKey)
    const syncFrontmatter = () => {
      const current = config.get(FILE_DOC_SEED.frontmatterKey)
      if (current === lastFrontmatter) return
      lastFrontmatter = current
      // Null body ref ⇒ no body has synced yet (e.g. this fired before the seed's own `onUpdate`);
      // that path re-attaches the frontmatter itself, so there is nothing to do here.
      if (lastSyncedBodyRef.current !== null) {
        onChangeRef.current(
          applyFrontmatter(typeof current === 'string' ? current : '', lastSyncedBodyRef.current)
        )
      }
    }

    provider.on('synced', report)
    provider.on('join-error', onJoinError)
    config.observe(report)
    config.observe(syncFrontmatter)
    report()
    if (provider.joinError) onJoinError(provider.joinError)

    return () => {
      provider.off('synced', report)
      provider.off('join-error', onJoinError)
      config.unobserve(report)
      config.unobserve(syncFrontmatter)
      // Report NOT ready on teardown — the safe direction. If this effect ever re-runs while mounted
      // (a future dep change), briefly gating autosave off is harmless; reporting `true` here could
      // ungate it while the doc is unready.
      onCollabReadyChange(false)
    }
  }, [collaboration, editor, onCollabReadyChange, setCollabReady])

  /**
   * Owns editability for the collaborative lifecycle: `useEditor`'s `editable` is only the initial
   * value, and the streaming/settle effect only moves content in collab mode (never toggles
   * editability) — so re-apply here whenever collaboration readiness (synced + seeded) or an agent
   * stream flips `isEditable`.
   */
  useEffect(() => {
    if (!editor || !collaborationEnabled) return
    if (editor.isEditable === isEditable) return
    // Defer out of the render/commit phase. `isEditable` flips from collab readiness (synced + seeded),
    // which is driven by a Yjs `config.observe` firing synchronously inside `Y.applyUpdate` — so this
    // effect can run while React is mid-render. `setEditable` re-applies the view state and emits an
    // `update` that the React binding commits with `flushSync`, which throws ("cannot flush while
    // rendering") in that window. A microtask runs right after the current commit, before paint; re-check
    // liveness/value since either can change before it fires.
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled || editor.isDestroyed) return
      if (editor.isEditable !== isEditable) editor.setEditable(isEditable)
    })
    return () => {
      cancelled = true
    }
  }, [editor, collaborationEnabled, isEditable])

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
  const settleRunSeqRef = useRef(0)
  const pendingCollapseRef = useRef(false)
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
    // Editor view mutations flush synchronously through the @tiptap/react binding (setContent mounts
    // the React node views via flushSync — tiptap#3764), so calling them directly in this effect body
    // throws "flushSync ... cannot flush while rendering" when the effect runs mid-render. Defer to a
    // microtask (after commit, before paint). The streaming rAF tick below already runs off-render.
    //
    // Tag each run: a deferred mutation applies only if it is still the latest run (this effect has
    // several early-return exits, so a run-token beats a per-exit cleanup flag) and the editor is
    // alive. This drops a superseded run's microtask when React ran the next pass — a newer stream or
    // settle — before the microtask flushed, so it can't overwrite the newer state.
    const runSeq = ++settleRunSeqRef.current
    const runOffRender = (mutate: () => void) => {
      queueMicrotask(() => {
        if (runSeq !== settleRunSeqRef.current || editor.isDestroyed) return
        mutate()
      })
    }
    // Collaborative surface: stream by applying a minimal CRDT diff into the live Y.Doc each frame
    // (never `setContent`, which would replace the shared doc and wipe peers). Each diff renders
    // locally and broadcasts to every peer, so the stream is smooth here and on other clients (e.g.
    // the standalone Files page) alike. This branch moves content only — editability for the collab
    // lifecycle is owned by the reactive effect above.
    if (collaborationEnabled) {
      if (isStreaming) {
        wasStreamingRef.current = true
        // Apply streamed diffs only after the shared doc has SEEDED (synced + seed flag, i.e.
        // `collabReady`). Applying onto an unseeded (empty) doc would let the later seed CRDT-merge into
        // it — transient garble. In the common case the doc is long seeded before an agent edit begins;
        // in the rare stream-before-seed race we wait, and since `collabReady` is an effect dep this
        // re-runs and applies once it lands (the read-only placeholder shows the base content meanwhile —
        // see `showPlaceholder`).
        if (!collabReady) return
        // Announce candidacy in the single-writer election (see the tick) so only one tab/window applies
        // this stream. The shadow is opened lazily in the tick, only when THIS client actually leads — so a
        // non-leader builds none, and a client that takes leadership mid-stream (a handoff) seeds its shadow
        // from the CURRENT doc, already carrying the prior leader's ops, never a stale base.
        if (!agentAnnouncedRef.current) {
          agentAnnouncedRef.current = true
          if (collaboration) announceAgentApplying(collaboration.awareness)
        }
        const body = splitFrontmatter(content).body
        if (body === lastStreamedBodyRef.current) return
        pendingStreamBodyRef.current = body
        if (streamRafRef.current !== null) return
        const tick = () => {
          const pending = pendingStreamBodyRef.current
          if (pending === null || pending === lastStreamedBodyRef.current) {
            streamRafRef.current = null
            return
          }
          // Hold a from-scratch rewrite (`update`) until settle so the open doc doesn't collapse to a
          // partial rewrite mid-stream (matching `main`). `append`/`patch`/`create` apply each frame — the
          // shadow reconcile is peer-safe, and base-less `append` fragments no longer reach the client (the
          // server fail-closes them), so there is nothing here to string-prefix or wipe-guard against.
          if (streamOperationRef.current === 'update') {
            streamRafRef.current = null
            return
          }
          // Single-writer election: only the leader (min clientID among clients announcing they apply this
          // stream) writes it into the shared doc, so multiple tabs/windows watching the same live copilot
          // stream don't each insert it and duplicate content. A non-leader renders the leader's ops via
          // Yjs; re-checked each frame, so a co-leader stops the moment awareness propagates. (The pick-up
          // direction — a successor beginning to write after the leader tab closes — waits for the next
          // content frame to run a tick; a stream that already delivered its last frame is covered by
          // settle and the durable write, so at worst a brief end-of-stream display lag, never a loss.)
          // Bounded residual (accepted): if two tabs start the SAME stream within the awareness-propagation
          // window they briefly both lead and duplicate a frame or two — a rare, transient, never-persisted
          // glitch (SYNC_NO_PERSIST keeps it out of storage; the durable edit_content write reconciles the
          // final doc). Resumes are sequential (the second tab sees the first's announcement), so the common
          // multi-tab case elects cleanly.
          if (
            collaboration &&
            !isAgentStreamLeader(collaboration.awareness, collaboration.doc.clientID)
          ) {
            // Not (or no longer) the leader: discard any shadow this client holds. A shadow only tracks
            // ITS OWN reconciles, so one kept across a leadership loss goes stale as the interim leader
            // advances the shared doc; reusing it on a later regain would re-emit ops for content already
            // present (duplication). Dropping it here means a regain rebuilds a FRESH shadow from the
            // current doc via the `??=` below — upholding "a non-leader holds none."
            if (agentStreamSessionRef.current) {
              endAgentStream(agentStreamSessionRef.current)
              agentStreamSessionRef.current = null
            }
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
          const el = containerRef.current
          const pinnedToBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 80 : false
          // Open the shadow lazily HERE — only when THIS client actually leads — seeded from the CURRENT
          // doc. A non-leader holds none (torn down above), so whether this client is a first-time leader
          // or one REGAINING leadership, `??=` finds a null ref and rebuilds fresh from the current doc,
          // already carrying the interim leader's ops (never a stale base). Defensive: a ready collab
          // editor always has a ySync binding.
          agentStreamSessionRef.current ??= beginAgentStream(editor)
          const session = agentStreamSessionRef.current
          if (!session || !applyAgentStreamFrame(editor, session, pending)) {
            streamRafRef.current = null
            return
          }
          streamRafRef.current = null
          lastStreamedBodyRef.current = pending
          lastStreamParseAtRef.current = performance.now()
          if (!disableStreamingAutoScroll && el && pinnedToBottom) el.scrollTop = el.scrollHeight
        }
        streamRafRef.current = requestAnimationFrame(tick)
        return
      }
      if (streamRafRef.current !== null) {
        cancelAnimationFrame(streamRafRef.current)
        streamRafRef.current = null
      }
      // Settle: apply the FINAL body so the Y.Doc exactly equals the streamed result — but ONLY the
      // elected writer applies it (the same min-clientID election the streaming tick uses). Without this,
      // N tabs watching one run each open a fresh shadow and reconcile current→final; a non-leader's local
      // settle microtask runs BEFORE the leader's final propagates (a server round-trip), so both insert
      // the same tail and Yjs keeps both (it does not dedupe identical text from two clients) → a
      // duplicated tail. The election is reliable here (unlike the bounded startup window): the stream ran
      // for seconds, so awareness is long converged. Each tab reads leadership BEFORE clearing its own
      // announcement — a remote clear is a network round-trip, always slower than these local microtasks,
      // so every tab sees the same announcer set and agrees on one leader. The leader reuses its
      // up-to-date shadow (catching a throttled last frame) or, if it never applied mid-stream (a held
      // `update`, or a pre-seed stream), opens a FRESH shadow from the current doc; a non-leader applies
      // nothing (the leader's final broadcasts to it) and frees any shadow it still held. The durable
      // `edit_content` write then lands as a noop diff for everyone.
      if (wasStreamingRef.current && collabReady) {
        wasStreamingRef.current = false
        agentAnnouncedRef.current = false
        const isSettleWriter =
          !collaboration || isAgentStreamLeader(collaboration.awareness, collaboration.doc.clientID)
        if (collaboration) clearAgentApplying(collaboration.awareness)
        lastStreamedBodyRef.current = null
        const heldSession = agentStreamSessionRef.current
        agentStreamSessionRef.current = null
        if (isSettleWriter) {
          const finalBody = splitFrontmatter(content).body
          const session = heldSession ?? beginAgentStream(editor)
          if (session) {
            runOffRender(() => applyAgentStreamFrame(editor, session, finalBody))
            // Free the shadow with an UNGUARDED microtask (not `runOffRender`): a rapid follow-up stream
            // can supersede the run token and drop the apply above, but the shadow must always be
            // destroyed. Queued after the apply, so it frees the shadow only once that has had its chance.
            queueMicrotask(() => endAgentStream(session))
          }
        } else if (heldSession) {
          // Non-leader: it never writes the final (the leader does + broadcasts it); free any shadow it held.
          queueMicrotask(() => endAgentStream(heldSession))
        }
      }
      return
    }
    if (isStreaming) {
      wasStreamingRef.current = true
      if (editor.isEditable) {
        runOffRender(() => {
          if (editor.isEditable) editor.setEditable(false)
        })
      }
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
      const settledVerdict = settledRef.current.verdict
      const shouldFocus = isInitialSettle && autoFocus
      // A settle owes a selection collapse. Track it as a ref, not just inline in this microtask: if a
      // newer run bumps the token before this microtask fires, this settle's task is dropped — but the
      // debt survives, and the run that supersedes it (settle OR the steady-sync path below) clears it.
      pendingCollapseRef.current = true
      // One ordered microtask: set body → collapse selection → re-apply editability. The collapse is
      // load-bearing and runs on every settle even when the body is unchanged — setContent maps a
      // pre-existing selection onto the new doc, so a prior select-all survives as "select everything",
      // permanently painting every divider/image with the rich-leaf-in-selection decoration (keymap.ts)
      // until the user clicks away. setTextSelection (not .focus()) never steals DOM focus.
      runOffRender(() => {
        syncEditorBody(splitFrontmatter(content).body)
        pendingCollapseRef.current = false
        editor.commands.setTextSelection(editor.state.doc.content.size)
        editor.setEditable(canEdit && settledVerdict && collabReady)
        if (shouldFocus) editor.commands.focus('end')
      })
      return
    }
    const settled = settledRef.current
    runOffRender(() => {
      syncEditorBody(splitFrontmatter(content).body)
      // Honor a collapse a superseded settle owed but never applied (its microtask was dropped when this
      // run bumped the token), so a post-stream select-all can't keep the leaf-in-selection decoration.
      if (pendingCollapseRef.current) {
        pendingCollapseRef.current = false
        editor.commands.setTextSelection(editor.state.doc.content.size)
      }
      if (settled) editor.setEditable(canEdit && settled.verdict && collabReady)
    })
  }, [
    editor,
    content,
    isStreaming,
    canEdit,
    autoFocus,
    disableStreamingAutoScroll,
    collaborationEnabled,
    collabReady,
  ])

  useEffect(
    () => () => {
      if (streamRafRef.current !== null) cancelAnimationFrame(streamRafRef.current)
      if (agentStreamSessionRef.current) {
        endAgentStream(agentStreamSessionRef.current)
        agentStreamSessionRef.current = null
      }
      lastStreamedBodyRef.current = null
      agentAnnouncedRef.current = false
    },
    []
  )

  const addToChat = useAddToChat()
  /**
   * No line range: this editor renders a ProseMirror document, whose block
   * boundaries do not correspond to markdown source lines (blank lines between
   * paragraphs, list markers, heading prefixes and fenced blocks all shift the
   * real line). Reporting a derived count would label the chip — and prompt the
   * agent — with line numbers that don't exist in the file.
   */
  const buildSelectionContext = useCallback((): ChatContext | null => {
    if (!editor) return null
    const { from, to } = editor.state.selection
    if (from === to) return null
    const text = editor.state.doc.textBetween(from, to, '\n')
    if (!text.trim()) return null
    return {
      kind: 'file_selection',
      fileId: file.id,
      fileName: file.name,
      label: buildFileSelectionLabel(file.name),
      text: truncateSelectionText(text),
    }
  }, [editor, file.id, file.name])

  const handleAddSelectionToChat = () => {
    const context = buildSelectionContext()
    if (context) addToChat(context)
  }

  useSelectionCopyBridge(containerRef, buildSelectionContext, workspaceId)

  // Show the read-only placeholder (the already-fetched markdown) whenever a collaborative doc has not yet
  // seeded — including during an agent stream that begins before the seed lands. Streamed diffs are held
  // until `collabReady` (see the streaming effect), so before then the editor is empty; the placeholder
  // shows the base content until the seed swaps it in, avoiding both a blank frame and a garbled merge.
  const showPlaceholder = collaborationEnabled && !collabReady

  /**
   * Find is off while the placeholder is up. The text on screen then belongs to the placeholder's own
   * editor, not to `editor` — which is still empty and hidden — so searching `editor` would answer
   * "No results" for text the user can see. Declining the shortcut hands it back to the browser, whose
   * native find reads the rendered placeholder correctly; it becomes ours once the seed lands.
   */
  const find = useMarkdownFind({ editor, enabled: enableFind && !showPlaceholder })

  return (
    // The find bar is a sibling of the scroller, not a child: pinned inside `containerRef` it would
    // scroll away with the document the moment stepping moved the view.
    <div className='relative flex min-h-0 flex-1 flex-col'>
      {find.isOpen && (
        <FindBar
          ariaLabel='Find in document'
          query={find.query}
          onQueryChange={find.setQuery}
          onNext={find.next}
          onPrev={find.prev}
          onClose={find.close}
          count={find.count}
          currentIndex={find.currentIndex}
          truncated={find.truncated}
          isLoading={false}
          inputRef={find.inputRef}
        />
      )}
      <div
        ref={containerRef}
        className={cn('relative flex flex-1 flex-col overflow-y-auto', isEditable && 'cursor-text')}
      >
        {editor && (
          <EditorBubbleMenu
            editor={editor}
            scrollContainerRef={containerRef}
            onAddToChat={handleAddSelectionToChat}
          />
        )}
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
        {showPlaceholder && placeholderContent && (
          <ReadOnlyPlaceholder content={placeholderContent} />
        )}
        <EditorContent
          editor={editor}
          className={cn(EDITOR_SURFACE_CLASS, showPlaceholder && 'hidden')}
        />
      </div>
    </div>
  )
}
