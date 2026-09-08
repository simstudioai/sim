'use client'

import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Chip, cn, toast } from '@sim/emcn'
import { FILE_DOC_SEED } from '@sim/realtime-protocol/file-doc'
import { PASTE_LIMITS, PASTE_RENDER_THRESHOLDS, utf8ByteLength } from '@sim/utils/paste'
import type { Extensions, JSONContent, Range } from '@tiptap/core'
import { isChangeOrigin } from '@tiptap/extension-collaboration'
import type { Editor } from '@tiptap/react'
import { EditorContent, useEditor } from '@tiptap/react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/auth/auth-client'
import {
  buildFileSelectionLabel,
  truncateSelectionText,
} from '@/lib/copilot/chat/selection-context'
import type { FileDownloadSource } from '@/lib/uploads/client/download'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { extractEmbeddedFileRef, extractImgSrcs } from '@/lib/uploads/utils/embedded-image-ref'
import { FindBar } from '@/app/workspace/[workspaceId]/components'
import { FileSaveConflict } from '@/app/workspace/[workspaceId]/files/components/file-viewer/file-save-conflict'
import { PreviewLoadingFrame } from '@/app/workspace/[workspaceId]/files/components/file-viewer/preview-shared'
import {
  announceAgentApplying,
  clearAgentApplying,
  isAgentStreamLeader,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/collaboration/agent-stream-leader'
import {
  type AgentStreamSession,
  applyAgentStreamFrame,
  beginAgentStream,
  endAgentStream,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/collaboration/apply-streamed-markdown'
import { isCollabReady } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/collaboration/readiness'
import { useFileDocCollaboration } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/collaboration/use-file-doc-collaboration'
import { createMarkdownEditorExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/editor-extensions'
import { useMarkdownFind } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/find'
import { findHeadingPos } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/heading-anchors'
import { moveDraggedImageNode } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-drag-move'
import {
  extractImageFiles,
  findHostedImageAttrs,
  shouldSkipFileUpload,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-paste'
import {
  beginImageUploads,
  findImageUpload,
  findImageUploadRange,
  finishImageUpload,
  removeImageUpload,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-upload'
import {
  applyFrontmatter,
  normalizeLinkHref,
  postProcessSerializedMarkdown,
  splitFrontmatter,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'
import { parseMarkdownToDoc } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-parse'
import { isPlainTextPaste } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-paste'
import { useEditorMentions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/mention'
import { EditorBubbleMenu } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/bubble-menu'
import { ImageBubbleMenu } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/image-menu'
import { LinkHoverCard } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/link-hover-card'
import { TableBubbleMenu } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/table-menu'
import { normalizeMarkdownContent } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/normalize-content'
import { isRoundTripSafe } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/round-trip-safety'
import { firstHeadingTitle } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/title-heading'
import { TextEditor } from '@/app/workspace/[workspaceId]/files/components/file-viewer/text-editor'
import { useEditableFileContent } from '@/app/workspace/[workspaceId]/files/components/file-viewer/use-editable-file-content'
import { useSelectionCopyBridge } from '@/app/workspace/[workspaceId]/files/components/file-viewer/use-selection-copy-bridge'
import { isUntitledName } from '@/app/workspace/[workspaceId]/files/untitled-title'
import { useUploadWorkspaceFile } from '@/hooks/queries/workspace-files'
import { useAddToChat } from '@/hooks/use-add-to-chat'
import type { SaveStatus } from '@/hooks/use-autosave'
import { useFileContentSource } from '@/hooks/use-file-content-source'
import type { ChatContext } from '@/stores/panel'
import '@sim/emcn/components/code/code.css'
import '@/app/workspace/[workspaceId]/files/components/file-viewer/document-table.css'
import '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/rich-markdown-editor.css'

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

function warnRichMarkdownPasteLimit(reason?: 'paste' | 'formatting') {
  if (reason === 'formatting') {
    toast.warning('Pasted text kept without automatic formatting', {
      description: 'Adding that formatting would exceed the rich-text editing limit.',
    })
    return
  }
  toast.warning('Paste is too large for rich-text editing', {
    description: `Rich-text editing supports up to ${PASTE_RENDER_THRESHOLDS.ENHANCED_TEXT_CHARACTERS.toLocaleString()} characters. Use the source editor for larger documents.`,
  })
}

/**
 * The editor's reading column — the centered, padded surface both the live editor and the read-only
 * {@link ReadOnlyPlaceholder} render into, so the two are geometrically identical and the placeholder →
 * live swap never reflows. Shared as one constant to keep them in lockstep.
 */
const EDITOR_SURFACE_CLASS =
  'mx-auto flex w-full max-w-[48rem] flex-1 flex-col px-8 py-6 selection:bg-[var(--selection-bg)] selection:text-[var(--text-primary)] dark:selection:bg-[var(--selection-dark)] dark:selection:text-white'

/** ProseMirror block positions do not correspond to markdown source line numbers. */
function buildEditorSelectionContext(
  editor: Editor | null,
  file: Pick<WorkspaceFileRecord, 'id' | 'name'>
): ChatContext | null {
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
}

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
  file: WorkspaceFileRecord
  workspaceId: string
}

function ReadOnlyPlaceholder({ content, file, workspaceId }: ReadOnlyPlaceholderProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editor = useEditor({
    extensions: EXTENSIONS,
    editable: false,
    // Render synchronously on first paint (safe — this surface is client-only, never SSR'd) so the
    // placeholder appears instantly like the static HTML it replaced, instead of blanking for a frame
    // while the editor mounts.
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    content,
    editorProps: {
      attributes: {
        class: 'rich-markdown-nodes rich-markdown-prose',
        'aria-label': 'Document preview',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-readonly': 'true',
      },
    },
  })
  const buildSelectionContext = useCallback(
    () => buildEditorSelectionContext(editor, { id: file.id, name: file.name }),
    [editor, file.id, file.name]
  )
  useSelectionCopyBridge(containerRef, buildSelectionContext, workspaceId)
  return <EditorContent ref={containerRef} editor={editor} className={EDITOR_SURFACE_CLASS} />
}

interface RichMarkdownEditorProps {
  file: WorkspaceFileRecord
  workspaceId: string
  canEdit: boolean
  autoFocus?: boolean
  onDirtyChange?: (isDirty: boolean) => void
  onSaveStatusChange?: (status: SaveStatus, retry?: () => Promise<void>) => void
  saveRef?: React.MutableRefObject<(() => Promise<void>) | null>
  downloadSourceRef?: React.MutableRefObject<FileDownloadSource | null>
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

/** Source fallback unmounts the rich surface so only one editing engine owns the local draft. */
export const RichMarkdownEditor = memo(function RichMarkdownEditor(props: RichMarkdownEditorProps) {
  const [sourceFileId, setSourceFileId] = useState<string | null>(null)
  if (sourceFileId === props.file.id)
    return (
      <TextEditor
        {...props}
        previewMode='editor'
        disableStreamingAutoScroll={props.disableStreamingAutoScroll ?? false}
      />
    )
  return <RichMarkdownSurface {...props} onEditSource={() => setSourceFileId(props.file.id)} />
})

interface RichMarkdownSurfaceProps extends RichMarkdownEditorProps {
  onEditSource: () => void
}

/** Inline rich editor; agent output streams read-only before editing becomes available on settle. */
function RichMarkdownSurface({
  file,
  workspaceId,
  canEdit,
  autoFocus,
  onDirtyChange,
  onSaveStatusChange,
  saveRef,
  downloadSourceRef,
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
  onEditSource,
}: RichMarkdownSurfaceProps) {
  const { data: session, isPending: isSessionPending } = useSession()
  const userId = session?.user?.id ?? ''
  const userName = session?.user?.name?.trim() || 'Collaborator'

  /**
   * Client-autosave gate. For a NON-collaborative file this is `true` (the client owns durability and
   * autosaves the markdown). For a collaborative file it stays `false`: the realtime relay persists the
   * shared document to markdown server-side, so the client must never also autosave — a stale keystroke
   * saving over a server/copilot edit is exactly the clobber the server path closes. The child reports
   * the right value up via `onClientAutosaveChange`.
   *
   * Initialize from the `collaborative` prop (NOT unconditionally `true`): a collaborative file must
   * start with autosave OFF, or a save could fire in the window before the child mounts and reports —
   * re-clobbering exactly what this closes. The child turns it on for the non-collaborative fallback.
   */
  const [canClientAutosave, setCanClientAutosave] = useState(!collaborative)

  const {
    content,
    setDraftContent,
    isStreamInteractionLocked,
    isContentLoading,
    hasContentError,
    saveImmediately,
    hasConflict,
    isReloading,
    reloadLatestContent,
    downloadDraft,
    acceptedBaselineContent,
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
    canAutosave: canClientAutosave,
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
    <>
      {hasConflict && (
        <FileSaveConflict
          isReloading={isReloading}
          reloadLatestContent={reloadLatestContent}
          downloadDraft={downloadDraft}
        />
      )}
      <LoadedRichMarkdownEditor
        key={previewContextKey ? `${file.id}:${previewContextKey}` : file.id}
        file={file}
        workspaceId={workspaceId}
        content={content}
        acceptedBaselineContent={acceptedBaselineContent}
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
        downloadSourceRef={downloadSourceRef}
        onClientAutosaveChange={setCanClientAutosave}
        onDeriveTitleFromHeading={onDeriveTitleFromHeading}
        enableFind={enableFind}
        onEditSource={onEditSource}
      />
    </>
  )
}

interface LoadedRichMarkdownEditorProps {
  file: WorkspaceFileRecord
  workspaceId: string
  /** The live content from the engine — grows as the agent streams, then settles to the saved doc. */
  content: string
  /** Accepted external baseline, excluding local serialization echoes and own save acknowledgements. */
  acceptedBaselineContent?: string
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
  downloadSourceRef?: React.MutableRefObject<FileDownloadSource | null>
  /** Reports client autosave eligibility; collaborative documents are persisted by the relay. */
  onClientAutosaveChange: (canAutosave: boolean) => void
  /** See {@link RichMarkdownEditorProps.onDeriveTitleFromHeading}. */
  onDeriveTitleFromHeading?: (headingText: string) => void
  /** See {@link RichMarkdownEditorProps.enableFind}. */
  enableFind: boolean
  onEditSource?: () => void
}

type CollaborationStatus = 'connecting' | 'ready' | 'reconnecting' | 'fatal'

interface SettledContent {
  frontmatter: string
  verdict: boolean
  /** Large source-only previews retain stored export; live growth is validated at download time. */
  canExportSnapshot: boolean
}

/** Assess an accepted source snapshot before rich editing can change its representation. */
function lockSettled(content: string): SettledContent {
  return {
    frontmatter: splitFrontmatter(content).frontmatter,
    verdict: isRoundTripSafe(content),
    canExportSnapshot:
      content.length <= PASTE_LIMITS.RICH_MARKDOWN_BYTES &&
      utf8ByteLength(content, PASTE_LIMITS.RICH_MARKDOWN_BYTES) <= PASTE_LIMITS.RICH_MARKDOWN_BYTES,
  }
}

/** The single TipTap editor: read-only while streaming, editable on settle; frontmatter is held aside and re-applied. */
export function LoadedRichMarkdownEditor({
  file,
  workspaceId,
  content,
  acceptedBaselineContent,
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
  downloadSourceRef,
  onClientAutosaveChange,
  onDeriveTitleFromHeading,
  enableFind,
  onEditSource,
}: LoadedRichMarkdownEditorProps) {
  /** Whether this editor mounted mid-stream — if so it starts empty and syncs streamed chunks until settle. */
  const [streamingAtMount] = useState(isStreaming)

  /** Only accepted source snapshots and stream settlement change editing eligibility. */
  const [settled, setSettled] = useState<SettledContent | null>(() =>
    streamingAtMount ? null : lockSettled(content)
  )
  const [acceptedBaseline, setAcceptedBaseline] = useState(acceptedBaselineContent)
  /**
   * Collaboration is decided once at mount from synchronously-available inputs
   * via `useState`-init, and never changes — TipTap
   * fixes the extension set at editor creation, so it cannot turn on later. Enabled on a
   * `collaborative` surface (the Files page or the embedded chat file preview) for an editable,
   * round-trip-safe workspace document with a known user, as long as it is not ALREADY streaming at
   * mount. An agent stream that begins AFTER mount is applied as CRDT
   * diffs into the live doc, so collaboration and streaming coexist (see the streaming effect below).
   */
  const [collaborationEnabled] = useState(
    () =>
      collaborative &&
      canEdit &&
      !streamingAtMount &&
      (settled?.verdict ?? false) &&
      Boolean(userId) &&
      (file.storageContext ?? 'workspace') === 'workspace'
  )
  if (
    !collaborationEnabled &&
    !isStreaming &&
    acceptedBaselineContent !== undefined &&
    acceptedBaselineContent !== acceptedBaseline
  ) {
    setAcceptedBaseline(acceptedBaselineContent)
    setSettled(lockSettled(acceptedBaselineContent))
  }
  /**
   * Whether the collaborative document is safe to edit + persist: synced and seeded.
   * Starts `false` for a collaborative document — so the editor is read-only and
   * autosave gated until the shared content has arrived (a user must not type into an
   * empty, unsynced doc, which the seed would then discard) — and `true` for a local one.
   */
  const [collabStatus, setCollabStatus] = useState<CollaborationStatus>(() =>
    collaborationEnabled ? 'connecting' : 'ready'
  )
  const collabReady = collabStatus === 'ready'
  const isEditable = canEdit && !isStreaming && (settled?.verdict ?? false) && collabReady

  const collaboration = useFileDocCollaboration({
    workspaceId,
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
    streamingAtMount || collaborationEnabled
      ? ''
      : parseMarkdownToDoc(splitFrontmatter(content).body)
  )
  /**
   * The already-fetched markdown, parsed once, for the read-only {@link ReadOnlyPlaceholder} shown while
   * a collaborative doc waits for its server seed. Held only when collaborating; the local path seeds
   * the live editor directly, so it needs no placeholder.
   */
  const [placeholder] = useState(() =>
    collaborationEnabled
      ? { content: parseMarkdownToDoc(splitFrontmatter(content).body), markdown: content }
      : null
  )
  /**
   * The body currently shown in the editor: seeded from a settled mount, updated on local edits (via
   * onUpdate) and on each streamed sync. Incremental edits (append/patch) stream complete snapshots and
   * always apply; a from-scratch rebuild (create/update) only applies while it still extends this, so a
   * rewrite holds the current content instead of collapsing to a partial result.
   */
  const lastSyncedBodyRef = useRef<string | null>(
    streamingAtMount ? null : splitFrontmatter(content).body
  )
  const lastSyncedFrontmatterRef = useRef(settled?.frontmatter ?? '')
  /**
   * The body the AGENT last applied into the collaborative doc — a dedup guard for the collab streaming
   * tick, so an unchanged frame skips a redundant shadow reconcile/reparse. Written ONLY by the streaming
   * tick (never by `onUpdate`), and reset to `null` on settle for the next stream. It is NOT a string-prefix
   * baseline: the mid-stream hold is decided by operation (`update` waits for settle), not by comparing the
   * raw preview against the editor's canonical markdown.
   */
  const lastStreamedBodyRef = useRef<string | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveShortcutRef = useRef(onSaveShortcut)

  /**
   * The frontmatter to re-attach to the body on save. For a collaborative doc it lives in the CRDT
   * (config map, seeded/updated server-side), so a server edit that changes it is reflected rather
   * than reverted by this editor's stale open-time copy; falls back to the accepted source snapshot
   * before the seed lands and for non-collaborative documents.
   */
  const resolveSaveFrontmatter = (): string => {
    const fromDoc = collaboration?.doc
      .getMap(FILE_DOC_SEED.configMap)
      .get(FILE_DOC_SEED.frontmatterKey)
    if (typeof fromDoc === 'string') return fromDoc
    return settled?.frontmatter ?? ''
  }
  const saveFrontmatterResolverRef = useRef(resolveSaveFrontmatter)

  /**
   * While the file is still unnamed, name it after its leading heading: `onDeriveTitleFromHeading` is
   * called (debounced) so the caller can rename the file, and `fileNameRef` lets the onUpdate handler
   * read the current name without re-subscribing. See {@link isUntitledName}.
   */
  const onDeriveTitleFromHeadingRef = useRef(onDeriveTitleFromHeading)
  const fileNameRef = useRef(file.name)
  const deriveTitleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * Read in the RAF tick so an already-scheduled tick still sees the latest edit kind (it can change
   * between sessions within one turn, e.g. an append followed by a rewrite).
   */
  const streamIsIncrementalRef = useRef(streamIsIncremental)
  const streamOperationRef = useRef(streamOperation)
  /** The live agent-stream shadow replica, held for the current stream and freed on settle/unmount. */
  const agentStreamSessionRef = useRef<AgentStreamSession | null>(null)
  /** True once this client has announced candidacy in the agent-stream election for the current stream. */
  const agentAnnouncedRef = useRef(false)
  const router = useRouter()
  const routerRef = useRef(router)

  const containerRef = useRef<HTMLDivElement>(null)
  const uploadFile = useUploadWorkspaceFile()
  const editorInstanceRef = useRef<Editor | null>(null)
  const source = useFileContentSource()
  const resolveImageSrcRef = useRef(source.resolveImageSrc)

  /** The picker anchor maps through edits while the operating-system file dialog is open. */
  const imageInputRef = useRef<HTMLInputElement>(null)
  const pendingImageAnchorRef = useRef<string | null>(null)

  /**
   * Uploads are sequential; every position is anchored before awaiting so queued images also follow
   * edits. Capture the editor instance, never a later file's editor, for completion and teardown.
   */
  const insertImagesRef = useRef<(images: File[], range: Range) => Promise<void>>(() =>
    Promise.resolve()
  )
  const insertImages = async (images: File[], range: Range) => {
    const editor = editorInstanceRef.current
    if (!editor) return
    const anchors = beginImageUploads(
      editor,
      range,
      images.map((image) => image.name)
    )
    for (const [index, image] of images.entries()) {
      if (editor.isDestroyed) break
      if (!editor.isEditable) {
        for (const pending of anchors) removeImageUpload(editor, pending)
        break
      }
      const anchor = anchors[index]
      if (!anchor || findImageUpload(editor, anchor) === null) continue
      const uploadingToastId = toast.info(`Uploading "${image.name}"…`, { duration: 0 })
      const result = await uploadFile
        .mutateAsync({ workspaceId, file: image, folderId: file.folderId ?? null })
        .catch(() => null)
      toast.dismiss(uploadingToastId)
      if (result) {
        const inserted = finishImageUpload(editor, anchor, result.file.url, image.name)
        if (!inserted && !editor.isDestroyed) {
          toast.info('The image was uploaded to the workspace but was not inserted.')
        }
      } else {
        removeImageUpload(editor, anchor)
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
  const cloneHostedImageRef = useRef<(imgSrcs: string[], range: Range) => boolean>(() => false)
  const cloneHostedImage = (imgSrcs: string[], range: Range) => {
    const editor = editorInstanceRef.current
    if (!editor) return false
    const matchedAttrs = findHostedImageAttrs(editor.state.doc, imgSrcs, source.resolveImageSrc)
    if (!matchedAttrs) return false
    try {
      return editor.chain().insertContentAt(range, { type: 'image', attrs: matchedAttrs }).run()
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
            getCurrentText: () => {
              const editor = editorInstanceRef.current
              return editor ? postProcessSerializedMarkdown(editor.getMarkdown()) : ''
            },
            getFrontmatter: () => saveFrontmatterResolverRef.current(),
            onRejected: warnRichMarkdownPasteLimit,
          },
        })
      : createMarkdownEditorExtensions({
          placeholder: PLACEHOLDER,
          embeds: true,
          pasteAdmission: {
            maxResultBytes: PASTE_LIMITS.RICH_MARKDOWN_BYTES,
            getCurrentText: () => lastSyncedBodyRef.current ?? '',
            getFrontmatter: () => saveFrontmatterResolverRef.current(),
            onRejected: warnRichMarkdownPasteLimit,
          },
        })
  )

  const editor = useEditor({
    extensions,
    editable: isEditable,
    enablePasteRules: false,
    autofocus: streamingAtMount ? false : autoFocus ? 'end' : false,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    content: initialContent,
    editorProps: {
      attributes: {
        class: 'rich-markdown-nodes rich-markdown-prose',
        'aria-label': `${file.name} document body`,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-readonly': String(!isEditable),
        'data-owned-shortcuts': 'Mod+K',
        'data-paste-max-bytes': String(PASTE_LIMITS.RICH_MARKDOWN_BYTES),
        'data-paste-max-html-bytes': String(PASTE_LIMITS.RICH_MARKDOWN_BYTES),
        'data-paste-handles-images': 'true',
      },
      handleKeyDown: (_view, event) => {
        if (event.isComposing || event.keyCode === 229 || event.shiftKey || event.altKey)
          return false
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
        const currentEditor = editorInstanceRef.current
        if (currentEditor && isPlainTextPaste(currentEditor)) return false
        const images = extractImageFiles(event.clipboardData)
        const html = event.clipboardData?.getData('text/html') ?? ''
        if (shouldSkipFileUpload(images, html, (src) => extractEmbeddedFileRef(src) !== null)) {
          const cloned = cloneHostedImageRef.current(extractImgSrcs(html), view.state.selection)
          if (cloned) {
            event.preventDefault()
            return true
          }
        }
        if (images.length === 0) return false
        event.preventDefault()
        void insertImagesRef.current(images, view.state.selection)
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
          const at = dropPos ?? view.state.selection.from
          void insertImagesRef.current(images, { from: at, to: at })
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
      /** The relay persists collaborative documents; a second Markdown projection has no consumer. */
      if (!collaborationEnabled && transaction.docChanged) {
        const md = postProcessSerializedMarkdown(editor.getMarkdown())
        lastSyncedBodyRef.current = md
        lastSyncedFrontmatterRef.current = saveFrontmatterResolverRef.current()
        onChangeRef.current(applyFrontmatter(lastSyncedFrontmatterRef.current, md))
      }
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

  useEffect(
    () => () => {
      if (deriveTitleTimerRef.current) clearTimeout(deriveTitleTimerRef.current)
    },
    []
  )

  /** The lifetime-stable editor and its async work consume only committed React inputs. */
  useLayoutEffect(() => {
    onChangeRef.current = onChange
    onSaveShortcutRef.current = onSaveShortcut
    saveFrontmatterResolverRef.current = resolveSaveFrontmatter
    onDeriveTitleFromHeadingRef.current = onDeriveTitleFromHeading
    fileNameRef.current = file.name
    streamIsIncrementalRef.current = streamIsIncremental
    streamOperationRef.current = streamOperation
    routerRef.current = router
    resolveImageSrcRef.current = source.resolveImageSrc
    insertImagesRef.current = insertImages
    cloneHostedImageRef.current = cloneHostedImage
    editorInstanceRef.current = editor
  })

  /**
   * The collaborative document lifecycle. In one effect because the three concerns
   * are one state machine keyed off the same provider events:
   * - **observe** readiness: the server seeds the doc authoritatively (content +
   *   `initialContentLoaded` flag in ONE Yjs update), so the client only watches for
   *   synced AND seeded — it never imports content itself on the happy path;
   * - **gate** the parent's autosave until the doc is synced AND seeded, so an
   *   empty/still-syncing doc can never overwrite the real file's markdown mirror;
   * - **preview** stored content in a separate read-only editor until authoritative content arrives.
   *   A retryable timeout never seeds the shared Y.Doc, so late server content cannot duplicate it.
   *   Terminal failures keep any existing live content visible but never editable.
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
    const setReady = (ready: boolean, fatal = false, retrying = false) => {
      // Child-local: gates editability (a user must never type into an unsynced/unseeded doc).
      setCollabStatus((previous) => {
        if (fatal) return 'fatal'
        if (ready) return 'ready'
        if (retrying) return 'reconnecting'
        return previous === 'ready' || previous === 'reconnecting' ? 'reconnecting' : 'connecting'
      })
      // Parent: gates CLIENT autosave. In a collaborative session the relay persists the doc to
      // markdown server-side (debounced + on last-disconnect), so the client must NOT also autosave —
      // a stale keystroke saving over a server/copilot edit is the clobber the server path closes.
      // Only the non-collaborative (solo) path client-autosaves.
      onClientAutosaveChange(collaboration ? false : ready)
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

    if (!provider) {
      setReady(false)
      return
    }

    const report = () => {
      const synced = provider.synced
      const seeded = config.get(FILE_DOC_SEED.flag) === true
      const fatal = provider.joinError?.retryable === false
      setReady(
        isCollabReady({ synced, seeded, fatal }),
        fatal,
        provider.joinError?.retryable === true
      )
    }
    /** Rejections must close the editing gate even if the document was already seeded. */
    const onJoinError = () => report()

    provider.on('synced', report)
    provider.on('join-error', onJoinError)
    config.observe(report)
    report()

    return () => {
      provider.off('synced', report)
      provider.off('join-error', onJoinError)
      config.unobserve(report)
      // Report NOT ready on teardown — the safe direction. If this effect ever re-runs while mounted
      // (a future dep change), briefly gating autosave off is harmless; reporting `true` here could
      // ungate it while the doc is unready.
      onClientAutosaveChange(false)
    }
  }, [collaboration, editor, onClientAutosaveChange])

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
    const input = imageInputRef.current
    const cancelImagePicker = () => {
      const anchor = pendingImageAnchorRef.current
      if (anchor) removeImageUpload(editor, anchor)
      pendingImageAnchorRef.current = null
    }
    input?.addEventListener('cancel', cancelImagePicker)
    editor.storage.slashCommand.insertImage = (at: number) => {
      const previous = pendingImageAnchorRef.current
      if (previous) removeImageUpload(editor, previous)
      pendingImageAnchorRef.current =
        beginImageUploads(editor, { from: at, to: at }, [''])[0] ?? null
      imageInputRef.current?.click()
    }
    return () => {
      input?.removeEventListener('cancel', cancelImagePicker)
      editor.storage.slashCommand.insertImage = null
    }
  }, [editor])

  useEditorMentions(editor, workspaceId, { navigable: true, disableTagging })

  const wasStreamingRef = useRef(streamingAtMount)

  const pendingStreamSourceRef = useRef<ReturnType<typeof splitFrontmatter> | null>(null)
  const streamRafRef = useRef<number | null>(null)
  const lastStreamParseAtRef = useRef(0)
  const settleRunSeqRef = useRef(0)
  const pendingCollapseRef = useRef(false)
  useEffect(() => {
    if (!editor) return
    const syncEditorContent = (markdown: string) => {
      const { body, frontmatter } = splitFrontmatter(markdown)
      lastSyncedFrontmatterRef.current = frontmatter
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
        const source = splitFrontmatter(content)
        if (source.body === lastStreamedBodyRef.current) return
        pendingStreamSourceRef.current = source
        if (streamRafRef.current !== null) return
        const tick = () => {
          const pending = pendingStreamSourceRef.current?.body ?? null
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
      const source = splitFrontmatter(content)
      if (source.body === lastSyncedBodyRef.current) return
      pendingStreamSourceRef.current = source
      if (streamRafRef.current !== null) return
      /** Self-re-arming tick: parse the latest pending body, but throttle a large one (cheap re-check, no parse) until due. */
      const tick = () => {
        const source = pendingStreamSourceRef.current
        const pending = source?.body ?? null
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
        lastSyncedFrontmatterRef.current = source?.frontmatter ?? ''
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
    const isInitialSettle = settled === null
    if (isInitialSettle || wasStreamingRef.current) {
      wasStreamingRef.current = false
      const nextSettled = lockSettled(content)
      setSettled(nextSettled)
      const settledVerdict = nextSettled.verdict
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
        syncEditorContent(content)
        pendingCollapseRef.current = false
        editor.commands.setTextSelection(editor.state.doc.content.size)
        editor.setEditable(canEdit && settledVerdict && collabReady)
        if (shouldFocus) editor.commands.focus('end')
      })
      return
    }
    runOffRender(() => {
      syncEditorContent(content)
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
    acceptedBaselineContent,
    settled,
    collaboration,
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
  const buildSelectionContext = useCallback(
    () => buildEditorSelectionContext(editor, { id: file.id, name: file.name }),
    [editor, file.id, file.name]
  )

  const handleAddSelectionToChat = () => {
    const context = buildSelectionContext()
    if (context) addToChat(context)
  }

  /** Stored content belongs to a separate preview, never to an unseeded collaborative document. */
  const showPlaceholder =
    collaborationEnabled &&
    (collabStatus === 'connecting' ||
      (collabStatus !== 'ready' &&
        collaboration?.doc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.flag) !== true))
  const showReconnecting = collaborationEnabled && collabStatus === 'reconnecting'
  const collabFailure = collaboration?.provider?.joinError ?? null
  const showCollabFailure = collaborationEnabled && collabStatus === 'fatal' ? collabFailure : null
  const canExportSnapshot = settled?.canExportSnapshot !== false

  useImperativeHandle<FileDownloadSource | null, FileDownloadSource | null>(
    downloadSourceRef,
    () =>
      editor && canExportSnapshot
        ? {
            fileId: file.id,
            workspaceId,
            getContent: () => {
              if (editor.isDestroyed) return null
              if (showPlaceholder) return placeholder?.markdown ?? null
              if (collaborationEnabled) {
                return applyFrontmatter(
                  saveFrontmatterResolverRef.current(),
                  postProcessSerializedMarkdown(editor.getMarkdown())
                )
              }
              /** Preserve unsupported source syntax and the displayed frame of a held rewrite. */
              if (lastSyncedBodyRef.current === null) return null
              return applyFrontmatter(lastSyncedFrontmatterRef.current, lastSyncedBodyRef.current)
            },
          }
        : null,
    [
      editor,
      file.id,
      workspaceId,
      showPlaceholder,
      placeholder,
      collaborationEnabled,
      canExportSnapshot,
    ]
  )

  useSelectionCopyBridge(containerRef, buildSelectionContext, workspaceId, !showPlaceholder)

  /**
   * Find is off while the placeholder is up. The text on screen then belongs to the placeholder's own
   * editor, not to `editor` — which is still empty and hidden — so searching `editor` would answer
   * "No results" for text the user can see. Declining the shortcut hands it back to the browser, whose
   * native find reads the rendered placeholder correctly; it becomes ours once the seed lands.
   */
  const find = useMarkdownFind({ editor, enabled: enableFind && !showPlaceholder })
  const replaceControls = useMemo(
    () =>
      isEditable
        ? {
            value: find.replacement,
            onChange: find.setReplacement,
            onReplace: find.replaceCurrent,
            onReplaceAll: find.replaceAll,
            canReplace: find.count > 0,
            canReplaceAll: find.count > 0 && !find.truncated,
          }
        : undefined,
    [
      find.count,
      find.replaceAll,
      find.replaceCurrent,
      find.replacement,
      find.setReplacement,
      find.truncated,
      isEditable,
    ]
  )

  return (
    // The find bar is a sibling of the scroller, not a child: pinned inside `containerRef` it would
    // scroll away with the document the moment stepping moved the view.
    <div className='relative flex min-h-0 flex-1 flex-col'>
      {canEdit && !isStreaming && settled?.verdict === false && onEditSource && (
        <div
          role='status'
          className='flex items-center gap-2 border-[var(--border)] border-b px-4 py-2 text-[var(--text-muted)] text-small'
        >
          <p className='flex-1'>
            This document needs source editing to preserve its content or handle its size.
          </p>
          <Chip onClick={onEditSource}>Edit source</Chip>
        </div>
      )}
      {showReconnecting && (
        <div
          role='status'
          aria-live='polite'
          className='border-[var(--border)] border-b px-4 py-2 text-[var(--text-muted)] text-small'
        >
          Reconnecting…
        </div>
      )}
      {showCollabFailure && (
        <div
          role='status'
          aria-live='polite'
          className='border-[var(--border)] border-b px-4 py-2 text-[var(--text-muted)] text-small'
        >
          {showCollabFailure.code === 'ACCESS_REVOKED' || showCollabFailure.code === 'ACCESS_DENIED'
            ? 'You no longer have edit access to this document.'
            : 'Live editing is unavailable.'}
        </div>
      )}
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
          replace={replaceControls}
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
        {editor && <ImageBubbleMenu editor={editor} scrollContainerRef={containerRef} />}
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
            const editor = editorInstanceRef.current
            const anchor = pendingImageAnchorRef.current
            const range = editor && anchor ? findImageUploadRange(editor, anchor) : null
            if (editor && anchor) removeImageUpload(editor, anchor)
            pendingImageAnchorRef.current = null
            input.value = ''
            if (images.length === 0) return
            if (range === null) {
              toast.info(
                'The insertion location changed. Choose a new location and select the image again.'
              )
              return
            }
            void insertImagesRef.current(images, range)
          }}
        />
        {showPlaceholder && placeholder && (
          <ReadOnlyPlaceholder
            content={placeholder.content}
            file={file}
            workspaceId={workspaceId}
          />
        )}
        <EditorContent
          editor={editor}
          className={cn(EDITOR_SURFACE_CLASS, showPlaceholder && 'hidden')}
        />
      </div>
    </div>
  )
}
