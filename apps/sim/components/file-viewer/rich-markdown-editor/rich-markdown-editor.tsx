'use client'

import {
  type MutableRefObject,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { Button } from '@sim/emcn/button'
import { FindBar } from '@sim/emcn/find-bar'
import { InlineNotice } from '@sim/emcn/status'
import { FILE_DOC_SEED } from '@sim/realtime-protocol/file-doc'
import { PASTE_LIMITS, PASTE_RENDER_THRESHOLDS, utf8ByteLength } from '@sim/utils/paste'
import type { Extensions, JSONContent, Range } from '@tiptap/core'
import { isChangeOrigin } from '@tiptap/extension-collaboration'
import type { Editor } from '@tiptap/react'
import { EditorContent, useEditor } from '@tiptap/react'
import { useRouter } from 'next/navigation'
import { useReportFileDocPeers } from '@/components/file-viewer/collaboration/file-doc-room'
import { FileSaveConflict } from '@/components/file-viewer/file-save-conflict'
import { PreviewError } from '@/components/file-viewer/preview-shared'
import { EditorBubbleMenu } from '@/components/file-viewer/rich-markdown-editor/bubble-menu'
import {
  announceAgentApplying,
  clearAgentApplying,
  isAgentStreamLeader,
} from '@/components/file-viewer/rich-markdown-editor/collaboration/agent-stream-leader'
import {
  type AgentStreamSession,
  applyAgentStreamFrame,
  beginAgentStream,
  endAgentStream,
} from '@/components/file-viewer/rich-markdown-editor/collaboration/apply-streamed-markdown'
import { isCollabReady } from '@/components/file-viewer/rich-markdown-editor/collaboration/readiness'
import { useFileDocCollaboration } from '@/components/file-viewer/rich-markdown-editor/collaboration/use-file-doc-collaboration'
import { createMarkdownEditorExtensions } from '@/components/file-viewer/rich-markdown-editor/editor-extensions'
import { useMarkdownFind } from '@/components/file-viewer/rich-markdown-editor/find/use-markdown-find'
import { scrollToHeading } from '@/components/file-viewer/rich-markdown-editor/heading-anchors'
import { moveDraggedImageNode } from '@/components/file-viewer/rich-markdown-editor/image-drag-move'
import {
  extractImageFiles,
  getImageFileFallback,
  type ImageFileFallback,
  normalizePastedImageSources,
  resolveImageFileFallback,
} from '@/components/file-viewer/rich-markdown-editor/image-paste'
import {
  beginImageUploads,
  findImageUpload,
  findImageUploadRange,
  finishImageUpload,
  removeImageUpload,
} from '@/components/file-viewer/rich-markdown-editor/image-upload'
import { LinkHoverCard } from '@/components/file-viewer/rich-markdown-editor/link-hover-card'
import {
  applyFrontmatter,
  normalizeLinkHref,
  postProcessSerializedMarkdown,
  splitFrontmatter,
} from '@/components/file-viewer/rich-markdown-editor/markdown-fidelity'
import { parseMarkdownToDoc } from '@/components/file-viewer/rich-markdown-editor/markdown-parse'
import { isPlainTextPaste } from '@/components/file-viewer/rich-markdown-editor/markdown-paste'
import { MarkdownStreamingContext } from '@/components/file-viewer/rich-markdown-editor/markdown-streaming-context'
import { normalizeMarkdownContent } from '@/components/file-viewer/rich-markdown-editor/normalize-content'
import styles from '@/components/file-viewer/rich-markdown-editor/rich-markdown-editor.module.css'
import { isRoundTripSafe } from '@/components/file-viewer/rich-markdown-editor/round-trip-safety'
import { TableBubbleMenu } from '@/components/file-viewer/rich-markdown-editor/table-menu'
import {
  firstHeadingTitle,
  isSelectionInLeadingHeading,
} from '@/components/file-viewer/rich-markdown-editor/title-heading'
import { useEditorMentions } from '@/components/file-viewer/rich-markdown-editor/use-editor-mentions'
import { useMarkdownSession } from '@/components/file-viewer/rich-markdown-editor/use-markdown-session'
import { TextEditor } from '@/components/file-viewer/text-editor'
import type { FileEditingProps } from '@/components/file-viewer/types'
import { isUntitledName } from '@/components/file-viewer/untitled-title'
import { useEditableFileContent } from '@/components/file-viewer/use-editable-file-content'
import { useSelectionCopyBridge } from '@/components/file-viewer/use-selection-copy-bridge'
import {
  buildFileSelectionLabel,
  truncateSelectionText,
} from '@/lib/mothership/chat/selection-context'
import { toast } from '@/lib/toast/sink'
import type { FileDownloadSource } from '@/lib/uploads/client/download'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { useUploadWorkspaceFile } from '@/hooks/queries/workspace-files'
import { useFileContentSource } from '@/hooks/use-file-content-source'
import type { ChatContext } from '@/stores/panel'

const PLACEHOLDER = "Write something, or press '/' for commands…"

/** The shared extension set of the read-only preview shown while a shared document syncs. */
const PREVIEW_EXTENSIONS = createMarkdownEditorExtensions({ placeholder: PLACEHOLDER })

const UPLOAD_NOTICE_DURATION = 0

/** A streamed body past this many characters re-parses at most once per throttle window. */
const STREAM_REPARSE_THROTTLE_THRESHOLD = 40_000
const STREAM_REPARSE_THROTTLE_MS = 120
/** Within this many pixels of the end, streamed content keeps the document scrolled to its end. */
const STREAM_STICK_THRESHOLD_PX = 80

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

/** ProseMirror positions do not correspond to source lines, so a selection carries no range. */
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

/** Follows a same-page anchor by scrolling to its heading. */
function followHeadingLink(view: Editor['view'], event: MouseEvent): boolean {
  const href = (event.target as HTMLElement | null)?.closest('a')?.getAttribute('href')
  if (!href?.startsWith('#')) return false
  event.preventDefault()
  scrollToHeading(view, href)
  return true
}

interface ReadOnlyPlaceholderProps {
  content: JSONContent
  file: WorkspaceFileRecord
  workspaceId: string
}

/**
 * The stored Markdown, read-only, while a shared document waits for its server seed: the same
 * extensions as the live editor so the swap neither repaints nor reflows, and no collaboration, so it
 * cannot write to the shared document.
 */
function ReadOnlyPlaceholder({ content, file, workspaceId }: ReadOnlyPlaceholderProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editor = useEditor({
    extensions: PREVIEW_EXTENSIONS,
    editable: false,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    content,
    editorProps: {
      attributes: {
        class: styles.prose,
        'aria-label': 'Document preview',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-readonly': 'true',
      },
      handleClick: (_view, _pos, event) =>
        Boolean(
          (event.target as HTMLElement | null)?.closest('a')?.getAttribute('href')?.startsWith('#')
        ),
      handleDOMEvents: { click: followHeadingLink },
    },
  })
  const buildSelectionContext = useCallback(
    () => buildEditorSelectionContext(editor, { id: file.id, name: file.name }),
    [editor, file.id, file.name]
  )
  useSelectionCopyBridge(containerRef, buildSelectionContext, workspaceId)
  return (
    <div ref={containerRef} className={styles.surface}>
      {editor && <LinkHoverCard editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  )
}

interface RichMarkdownEditorProps extends FileEditingProps {
  /** Live collaborative editing over the realtime relay. */
  collaborative?: boolean
  /** Names a still-untitled file after its leading heading once the reader finishes typing it. */
  onDeriveTitleFromHeading?: (fileId: string, headingText: string) => void
  /** Claims Cmd/Ctrl+F for find in the document. */
  enableFind?: boolean
}

/**
 * Markdown in the rich editor. A document whose Markdown would not survive rich editing, or one too
 * large for it, offers "Edit source", which swaps in the source editor for the rest of the visit.
 */
export const RichMarkdownEditor = memo(function RichMarkdownEditor(props: RichMarkdownEditorProps) {
  const [sourceFileId, setSourceFileId] = useState<string | null>(null)
  if (sourceFileId === props.file.id) {
    const { collaborative, onDeriveTitleFromHeading, enableFind, ...editing } = props
    return <TextEditor {...editing} previewMode='editor' />
  }
  return <RichMarkdownSurface {...props} onEditSource={() => setSourceFileId(props.file.id)} />
})

interface RichMarkdownSurfaceProps extends RichMarkdownEditorProps {
  onEditSource: () => void
}

/**
 * Loads the file and keeps its draft. A shared document is persisted by the relay, so client
 * autosave stays off for it from the first render; a local one autosaves with draft recovery.
 */
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
  onAddToChat,
  streamingContent,
  isAgentEditing,
  streamIsIncremental,
  streamOperation,
  disableStreamingAutoScroll = false,
  previewContextKey,
  collaborative = false,
  onDeriveTitleFromHeading,
  enableFind = false,
  onEditSource,
}: RichMarkdownSurfaceProps) {
  const session = useMarkdownSession()
  const [canClientAutosave, setCanClientAutosave] = useState(!collaborative)
  /** Recovery and local reading are scoped to one file in one preview context. */
  const [collaborationReset, setCollaborationReset] = useState({
    fileId: file.id,
    previewContextKey,
    generation: 0,
  })
  const collaborationGeneration =
    collaborationReset.fileId === file.id &&
    collaborationReset.previewContextKey === previewContextKey
      ? collaborationReset.generation
      : 0
  const resetCollaboration = useCallback(() => {
    setCollaborationReset((previous) => ({
      fileId: file.id,
      previewContextKey,
      generation:
        previous.fileId === file.id && previous.previewContextKey === previewContextKey
          ? previous.generation + 1
          : 1,
    }))
  }, [file.id, previewContextKey])
  /** A relay older than read membership rejects a read-only member, who then reads locally. */
  const [localReadOnly, setLocalReadOnly] = useState<{
    fileId: string
    previewContextKey?: string
  } | null>(null)
  const collaborationDeclined =
    !canEdit &&
    localReadOnly?.fileId === file.id &&
    localReadOnly.previewContextKey === previewContextKey
  const declineCollaboration = useCallback(
    () => setLocalReadOnly({ fileId: file.id, previewContextKey }),
    [file.id, previewContextKey]
  )

  const {
    content,
    setDraftContent,
    isStreamInteractionLocked,
    isContentLoading,
    hasContentError,
    contentError,
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

  /** Collaboration is decided once, at mount, from the user; so the session must resolve first. */
  if (isContentLoading || session.isPending) return null
  if (hasContentError)
    return <PreviewError label='file' error={contentError ?? 'Failed to load file content'} />

  const shareDocument = collaborative && !collaborationDeclined
  const editor = (
    <LoadedRichMarkdownEditor
      key={`${file.id}:${previewContextKey ?? ''}:${collaborationDeclined ? 'local' : collaborationGeneration}`}
      recoveringCollaboration={collaborationGeneration > 0}
      onWriteAccessLost={resetCollaboration}
      onReadOnlyJoinRejected={declineCollaboration}
      file={file}
      workspaceId={workspaceId}
      content={content}
      acceptedBaselineContent={acceptedBaselineContent}
      isStreaming={isStreamInteractionLocked}
      streamIsIncremental={streamIsIncremental}
      streamOperation={streamOperation}
      disableStreamingAutoScroll={disableStreamingAutoScroll}
      onAddToChat={onAddToChat}
      canEdit={canEdit}
      userId={session.userId}
      userName={session.userName}
      autoFocus={autoFocus}
      collaborative={shareDocument}
      onChange={setDraftContent}
      onSaveShortcut={saveImmediately}
      downloadSourceRef={downloadSourceRef}
      onClientAutosaveChange={setCanClientAutosave}
      onDeriveTitleFromHeading={onDeriveTitleFromHeading}
      enableFind={enableFind}
      onEditSource={onEditSource}
      conflict={
        hasConflict ? (
          <FileSaveConflict
            isReloading={isReloading}
            reloadLatestContent={reloadLatestContent}
            downloadDraft={downloadDraft}
          />
        ) : null
      }
    />
  )
  return editor
}

interface LoadedRichMarkdownEditorProps {
  recoveringCollaboration: boolean
  onWriteAccessLost: () => void
  onReadOnlyJoinRejected: () => void
  file: WorkspaceFileRecord
  workspaceId: string
  content: string
  /** The accepted external baseline, without local echoes or own save acknowledgements. */
  acceptedBaselineContent?: string
  /** An agent is writing the file: the editor shows its stream read-only and settles after. */
  isStreaming: boolean
  streamIsIncremental?: boolean
  streamOperation?: string
  disableStreamingAutoScroll: boolean
  onAddToChat?: (context: ChatContext) => void
  canEdit: boolean
  userId: string
  userName: string
  autoFocus?: boolean
  collaborative: boolean
  onChange: (markdown: string) => void
  onSaveShortcut: () => Promise<void>
  downloadSourceRef?: MutableRefObject<FileDownloadSource | null>
  /** Client autosave is off for a shared document, which the relay persists. */
  onClientAutosaveChange: (canAutosave: boolean) => void
  onDeriveTitleFromHeading?: (fileId: string, headingText: string) => void
  enableFind: boolean
  onEditSource: () => void
  /** The save-conflict notice, shown above the document. */
  conflict: ReactNode
}

type CollaborationStatus = 'connecting' | 'ready' | 'reconnecting' | 'fatal'

interface SettledContent {
  frontmatter: string
  verdict: boolean
  canExportSnapshot: boolean
}

/** Judges a source snapshot before rich editing can change its representation. */
function lockSettled(content: string): SettledContent {
  return {
    frontmatter: splitFrontmatter(content).frontmatter,
    verdict: isRoundTripSafe(content),
    canExportSnapshot:
      content.length <= PASTE_LIMITS.RICH_MARKDOWN_BYTES &&
      utf8ByteLength(content, PASTE_LIMITS.RICH_MARKDOWN_BYTES) <= PASTE_LIMITS.RICH_MARKDOWN_BYTES,
  }
}

/** The single TipTap editor; frontmatter is held aside and re-applied on save. */
function LoadedRichMarkdownEditor({
  recoveringCollaboration,
  onWriteAccessLost,
  onReadOnlyJoinRejected,
  file,
  workspaceId,
  content,
  acceptedBaselineContent,
  isStreaming,
  streamIsIncremental,
  streamOperation,
  disableStreamingAutoScroll,
  onAddToChat,
  canEdit,
  userId,
  userName,
  autoFocus,
  collaborative,
  onChange,
  onSaveShortcut,
  downloadSourceRef,
  onClientAutosaveChange,
  onDeriveTitleFromHeading,
  enableFind,
  onEditSource,
  conflict,
}: LoadedRichMarkdownEditorProps) {
  /** An editor mounted mid-stream starts empty and follows the stream until it settles. */
  const [streamingAtMount] = useState(isStreaming)
  /** Only accepted source snapshots and a stream's settlement change editing eligibility. */
  const [settled, setSettled] = useState<SettledContent | null>(() =>
    streamingAtMount && !recoveringCollaboration
      ? null
      : lockSettled(recoveringCollaboration ? (acceptedBaselineContent ?? '') : content)
  )
  const [acceptedBaseline, setAcceptedBaseline] = useState(acceptedBaselineContent)
  /** TipTap fixes its extensions at creation, so collaboration cannot turn on later. */
  const [collaborationEnabled] = useState(
    () =>
      collaborative &&
      (!streamingAtMount || recoveringCollaboration) &&
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
  /** A shared document stays read-only until it has synced and been seeded. */
  const [collabStatus, setCollabStatus] = useState<CollaborationStatus>(() =>
    collaborationEnabled ? 'connecting' : 'ready'
  )
  const collabReady = collabStatus === 'ready'

  const reportPeers = useReportFileDocPeers()
  const collaboration = useFileDocCollaboration({
    workspaceId,
    fileId: file.id,
    userId,
    userName,
    enabled: collaborationEnabled,
    onWriteAccessLost,
    reportPeers,
  })
  const effectiveCanEdit = canEdit && (!collaborationEnabled || collaboration?.canWrite === true)
  const isEditable = effectiveCanEdit && !isStreaming && (settled?.verdict ?? false) && collabReady

  /** A shared document starts empty and fills from the server seed; a local one parses its source. */
  const [initialContent] = useState<JSONContent | string>(() =>
    streamingAtMount || collaborationEnabled
      ? ''
      : parseMarkdownToDoc(splitFrontmatter(content).body)
  )
  const [placeholder] = useState(() => {
    if (!collaborationEnabled) return null
    const markdown = recoveringCollaboration ? (acceptedBaselineContent ?? '') : content
    return { content: parseMarkdownToDoc(splitFrontmatter(markdown).body), markdown }
  })
  /**
   * The body the editor shows: seeded from a settled mount, then updated by local edits and each
   * streamed frame. `null` until a stream that began before mount shows its first frame.
   */
  const lastSyncedBodyRef = useRef<string | null>(
    streamingAtMount ? null : splitFrontmatter(content).body
  )
  const lastSyncedFrontmatterRef = useRef(settled?.frontmatter ?? '')
  /** The body the agent last applied into the shared document, so an unchanged frame is skipped. */
  const lastStreamedBodyRef = useRef<string | null>(null)
  /** Read in the frame tick, so a scheduled tick sees the latest edit kind. */
  const streamIsIncrementalRef = useRef(streamIsIncremental)
  const streamOperationRef = useRef(streamOperation)
  /** The agent stream's shadow replica, held for the current stream and freed on settle. */
  const agentStreamSessionRef = useRef<AgentStreamSession | null>(null)
  /** This client has announced itself in the election for which tab writes the stream. */
  const agentAnnouncedRef = useRef(false)
  const onChangeRef = useRef(onChange)
  const onSaveShortcutRef = useRef(onSaveShortcut)

  /** A shared document's frontmatter lives in the CRDT, so a server edit to it is kept. */
  const resolveSaveFrontmatter = (): string => {
    const fromDoc = collaboration?.doc
      .getMap(FILE_DOC_SEED.configMap)
      .get(FILE_DOC_SEED.frontmatterKey)
    if (typeof fromDoc === 'string') return fromDoc
    return settled?.frontmatter ?? ''
  }
  const saveFrontmatterResolverRef = useRef(resolveSaveFrontmatter)

  /** An untitled file takes its leading heading's name once, when the reader finishes the heading. */
  const onDeriveTitleFromHeadingRef = useRef(onDeriveTitleFromHeading)
  const fileNameRef = useRef(file.name)
  const headingTitlePendingRef = useRef(false)
  const headingTitleCommittedRef = useRef(false)
  const commitHeadingTitle = (editor: Editor) => {
    if (!headingTitlePendingRef.current || headingTitleCommittedRef.current) return
    headingTitlePendingRef.current = false
    if (!editor.isEditable || !isUntitledName(fileNameRef.current)) return
    const title = firstHeadingTitle(editor.state.doc)
    if (!title) return
    headingTitleCommittedRef.current = true
    onDeriveTitleFromHeadingRef.current?.(file.id, title)
  }

  const router = useRouter()
  const routerRef = useRef(router)
  const containerRef = useRef<HTMLDivElement>(null)
  const uploadFile = useUploadWorkspaceFile()
  const editorInstanceRef = useRef<Editor | null>(null)
  const source = useFileContentSource()
  const resolveImageSrcRef = useRef(source.resolveImageSrc)

  /** The picker's anchor follows edits while the system file dialog is open. */
  const imageInputRef = useRef<HTMLInputElement>(null)
  const pendingImageAnchorRef = useRef<string | null>(null)
  const imageUploadBatchesRef = useRef<Set<{
    editor: Editor
    anchors: string[]
    controller: AbortController
    noticeId?: string
  }> | null>(null)
  imageUploadBatchesRef.current ??= new Set()

  /** Uploads run one at a time; every position is anchored first so queued images follow edits. */
  const insertImagesRef = useRef<
    (images: File[], range: Range, fallback?: ImageFileFallback | null) => Promise<void>
  >(() => Promise.resolve())
  const insertImages = async (
    images: File[],
    range: Range,
    fallback?: ImageFileFallback | null
  ) => {
    const editor = editorInstanceRef.current
    if (!editor || !effectiveCanEdit) return
    const anchors = beginImageUploads(
      editor,
      range,
      images.map((image) => image.name)
    )
    const batch: {
      editor: Editor
      anchors: string[]
      controller: AbortController
      noticeId?: string
    } = { editor, anchors, controller: new AbortController() }
    imageUploadBatchesRef.current?.add(batch)
    try {
      for (const [index, image] of images.entries()) {
        if (editor.isDestroyed || !editor.isEditable || batch.controller.signal.aborted) break
        const anchor = anchors[index]
        if (!anchor || findImageUpload(editor, anchor) === null) continue
        batch.noticeId = toast.info(`Uploading "${image.name}"…`, {
          duration: UPLOAD_NOTICE_DURATION,
        })
        const result = await uploadFile
          .mutateAsync({
            workspaceId,
            file: image,
            folderId: file.folderId ?? null,
            signal: batch.controller.signal,
          })
          .catch(() => null)
        if (batch.noticeId) toast.dismiss(batch.noticeId)
        batch.noticeId = undefined
        if (batch.controller.signal.aborted) break
        if (result) {
          const inserted = finishImageUpload(
            editor,
            anchor,
            result.file.url,
            image.name,
            fallback ? resolveImageFileFallback(fallback, result.file.url) : undefined
          )
          if (!inserted && !editor.isDestroyed) {
            toast.info('The image was uploaded to the workspace but was not inserted.')
          }
        } else {
          removeImageUpload(editor, anchor)
        }
      }
    } finally {
      if (batch.noticeId) toast.dismiss(batch.noticeId)
      for (const anchor of anchors) removeImageUpload(editor, anchor)
      imageUploadBatchesRef.current?.delete(batch)
    }
  }

  const [extensions] = useState<Extensions>(() =>
    createMarkdownEditorExtensions({
      placeholder: PLACEHOLDER,
      collaboration: collaboration
        ? { doc: collaboration.doc, awareness: collaboration.awareness, user: collaboration.user }
        : undefined,
      pasteAdmission: {
        maxResultBytes: PASTE_LIMITS.RICH_MARKDOWN_BYTES,
        getCurrentText: () => {
          if (!collaboration) return lastSyncedBodyRef.current ?? ''
          const editor = editorInstanceRef.current
          return editor ? postProcessSerializedMarkdown(editor.getMarkdown()) : ''
        },
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
        class: styles.prose,
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
      /** Editing needs a modifier to follow a link (a plain click places the caret); read-only follows. */
      handleClick: (view, _pos, event) =>
        (!view.editable || event.metaKey || event.ctrlKey) &&
        Boolean((event.target as HTMLElement | null)?.closest('a')?.getAttribute('href')),
      handleDOMEvents: {
        click: (view, event) => {
          const href = (event.target as HTMLElement | null)?.closest('a')?.getAttribute('href')
          if (!href) return false
          if (view.editable && !(event.metaKey || event.ctrlKey)) return false
          if (href.startsWith('#')) return followHeadingLink(view, event)
          const normalized = normalizeLinkHref(href)
          if (!normalized) return false
          event.preventDefault()
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
      },
      transformPasted: (slice, view) =>
        normalizePastedImageSources(slice, view.state.doc, resolveImageSrcRef.current),
      handlePaste: (view, event, slice) => {
        if (!view.editable) return false
        const currentEditor = editorInstanceRef.current
        if (currentEditor && isPlainTextPaste(currentEditor)) return false
        const html = event.clipboardData?.getData('text/html') ?? ''
        const images = extractImageFiles(event.clipboardData)
        const fallback = getImageFileFallback(slice, images)
        if (html && slice.content.size > 0 && !fallback) return false
        if (images.length === 0) return false
        event.preventDefault()
        void insertImagesRef.current(images, view.state.selection, fallback)
        return true
      },
      handleDrop: (view, event, slice, moved) => {
        if (!view.editable) return false
        const html = event.dataTransfer?.getData('text/html') ?? ''
        const images = extractImageFiles(event.dataTransfer)
        const uploadFallback = getImageFileFallback(slice, images)
        if (!uploadFallback && moveDraggedImageNode(view, event, slice, moved)) return true
        if (html && slice.content.size > 0 && !uploadFallback) return false
        if (images.length > 0) {
          event.preventDefault()
          const dropPos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
          const at = dropPos ?? view.state.selection.from
          void insertImagesRef.current(images, { from: at, to: at }, uploadFallback)
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
      /** The relay persists a shared document; only a local one projects its Markdown here. */
      if (!collaborationEnabled && transaction.docChanged) {
        const md = postProcessSerializedMarkdown(editor.getMarkdown())
        lastSyncedBodyRef.current = md
        lastSyncedFrontmatterRef.current = saveFrontmatterResolverRef.current()
        onChangeRef.current(applyFrontmatter(lastSyncedFrontmatterRef.current, md))
      }
      /** Only the local reader's edits name the file, never a peer's half-synced heading. */
      if (isChangeOrigin(transaction)) return
      if (editor.isEditable && transaction.docChanged) headingTitlePendingRef.current = true
      if (!isSelectionInLeadingHeading(editor.state)) commitHeadingTitle(editor)
    },
    onSelectionUpdate: ({ editor }) => {
      if (!isSelectionInLeadingHeading(editor.state)) commitHeadingTitle(editor)
    },
    onBlur: ({ editor }) => {
      if (document.hasFocus()) commitHeadingTitle(editor)
    },
  })

  useEffect(
    () => () => {
      const liveEditor = editorInstanceRef.current
      if (liveEditor && !liveEditor.isDestroyed) commitHeadingTitle(liveEditor)
    },
    []
  )

  useLayoutEffect(() => {
    onChangeRef.current = onChange
    onSaveShortcutRef.current = onSaveShortcut
    saveFrontmatterResolverRef.current = resolveSaveFrontmatter
    onDeriveTitleFromHeadingRef.current = onDeriveTitleFromHeading
    fileNameRef.current = file.name
    routerRef.current = router
    resolveImageSrcRef.current = source.resolveImageSrc
    insertImagesRef.current = insertImages
    editorInstanceRef.current = editor
    streamIsIncrementalRef.current = streamIsIncremental
    streamOperationRef.current = streamOperation
  })

  /**
   * The shared document's lifecycle: readiness is synced and seeded (a protocol fact the relay
   * guarantees on join), it gates editing, and client autosave stays off while the relay persists.
   */
  useEffect(() => {
    const setReady = (ready: boolean, fatal = false, retrying = false) => {
      setCollabStatus((previous) => {
        if (fatal) return 'fatal'
        if (ready) return 'ready'
        if (retrying) return 'reconnecting'
        return previous === 'ready' || previous === 'reconnecting' ? 'reconnecting' : 'connecting'
      })
      onClientAutosaveChange(collaboration ? false : ready)
    }
    if (!collaboration) {
      setReady(true)
      return
    }
    const { provider, doc } = collaboration
    if (!editor || !provider) {
      setReady(false)
      return
    }
    const config = doc.getMap(FILE_DOC_SEED.configMap)
    const report = () => {
      const fatal = provider.joinError?.retryable === false
      if (fatal && !canEdit && provider.joinError?.code === 'ACCESS_DENIED')
        onReadOnlyJoinRejected()
      setReady(
        isCollabReady({
          synced: provider.synced,
          seeded: config.get(FILE_DOC_SEED.flag) === true,
          fatal,
        }),
        fatal,
        provider.joinError?.retryable === true
      )
    }
    provider.on('synced', report)
    provider.on('join-error', report)
    config.observe(report)
    report()
    return () => {
      provider.off('synced', report)
      provider.off('join-error', report)
      config.unobserve(report)
      onClientAutosaveChange(false)
    }
  }, [collaboration, editor, onClientAutosaveChange, canEdit, onReadOnlyJoinRejected])

  /** Readiness can flip inside a Yjs update mid-render, so editability follows on a microtask. */
  useEffect(() => {
    if (!editor || !collaborationEnabled || editor.isEditable === isEditable) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled || editor.isDestroyed) return
      if (editor.isEditable !== isEditable) editor.setEditable(isEditable)
    })
    return () => {
      cancelled = true
    }
  }, [editor, collaborationEnabled, isEditable])

  useEffect(() => {
    if (!editor || !effectiveCanEdit) return
    return () => {
      for (const batch of imageUploadBatchesRef.current ?? []) {
        batch.controller.abort()
        for (const anchor of batch.anchors) removeImageUpload(batch.editor, anchor)
        if (batch.noticeId) toast.dismiss(batch.noticeId)
      }
      imageUploadBatchesRef.current?.clear()
      const anchor = pendingImageAnchorRef.current
      if (anchor) removeImageUpload(editor, anchor)
      pendingImageAnchorRef.current = null
      if (imageInputRef.current) imageInputRef.current.value = ''
    }
  }, [editor, effectiveCanEdit])

  /** The `/` Image command opens the hidden picker at its position. */
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
      if (!editor.isEditable) return
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

  useEditorMentions(editor, workspaceId)

  /**
   * Follows the file's content: an agent's stream frame by frame (into the shared document as CRDT
   * diffs when collaborating), its settlement, and a local document's accepted source after a
   * reload. View changes run on a microtask, after commit, and only the latest run applies.
   */
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
      if (!effectiveCanEdit) {
        if (streamRafRef.current !== null) cancelAnimationFrame(streamRafRef.current)
        streamRafRef.current = null
        pendingStreamSourceRef.current = null
        if (collaboration && agentAnnouncedRef.current) clearAgentApplying(collaboration.awareness)
        agentAnnouncedRef.current = false
        if (agentStreamSessionRef.current) endAgentStream(agentStreamSessionRef.current)
        agentStreamSessionRef.current = null
        return
      }
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
          const pinnedToBottom = el
            ? el.scrollHeight - el.scrollTop - el.clientHeight < STREAM_STICK_THRESHOLD_PX
            : false
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
        const pinnedToBottom = el
          ? el.scrollHeight - el.scrollTop - el.clientHeight < STREAM_STICK_THRESHOLD_PX
          : false
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
        editor.setEditable(effectiveCanEdit && settledVerdict && collabReady)
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
      if (settled) editor.setEditable(effectiveCanEdit && settled.verdict && collabReady)
    })
  }, [
    editor,
    content,
    acceptedBaselineContent,
    settled,
    collaboration,
    isStreaming,
    effectiveCanEdit,
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

  const buildSelectionContext = useCallback(
    () => buildEditorSelectionContext(editor, { id: file.id, name: file.name }),
    [editor, file.id, file.name]
  )
  const handleAddSelectionToChat = onAddToChat
    ? () => {
        const context = buildSelectionContext()
        if (context) onAddToChat(context)
      }
    : undefined

  /** Stored content shows in its own preview, never in an unseeded shared document. */
  const showPlaceholder =
    collaborationEnabled &&
    (collabStatus === 'connecting' ||
      (collabStatus !== 'ready' &&
        collaboration?.doc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.flag) !== true))
  const showReconnecting = collaborationEnabled && collabStatus === 'reconnecting'
  const collabFailure =
    collaborationEnabled && collabStatus === 'fatal'
      ? (collaboration?.provider?.joinError ?? null)
      : null

  useImperativeHandle<FileDownloadSource | null, FileDownloadSource | null>(
    downloadSourceRef,
    () =>
      editor && settled?.canExportSnapshot !== false
        ? {
            fileId: file.id,
            workspaceId,
            getContent: () => {
              if (editor.isDestroyed) return null
              if (showPlaceholder) return placeholder?.markdown ?? null
              if (collaborationEnabled)
                return applyFrontmatter(
                  saveFrontmatterResolverRef.current(),
                  postProcessSerializedMarkdown(editor.getMarkdown())
                )
              /** Keeps unsupported source syntax and the shown frame of a held rewrite. */
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
      settled?.canExportSnapshot,
    ]
  )

  useSelectionCopyBridge(containerRef, buildSelectionContext, workspaceId, !showPlaceholder)

  /** Find waits for the seed: the placeholder's text is not in the live editor yet. */
  const find = useMarkdownFind({ editor, enabled: enableFind && !showPlaceholder })

  const needsSource = canEdit && !isStreaming && settled?.verdict === false
  return (
    <div className={styles.root}>
      {(conflict || needsSource || showReconnecting || collabFailure) && (
        <div className={styles.notices}>
          {conflict}
          {needsSource && (
            <InlineNotice
              message='This document needs source editing to preserve its content or handle its size.'
              action={
                <Button variant='quiet' size='compact' onClick={onEditSource}>
                  Edit source
                </Button>
              }
            />
          )}
          {showReconnecting && <InlineNotice message='Reconnecting…' />}
          {collabFailure && (
            <InlineNotice
              intent='warning'
              message={
                collabFailure.code === 'ACCESS_REVOKED' || collabFailure.code === 'ACCESS_DENIED'
                  ? 'You no longer have edit access to this document.'
                  : 'Live editing is unavailable.'
              }
            />
          )}
        </div>
      )}
      {find.isOpen && (
        <div className={styles.findFrame}>
          <FindBar
            label='Find in document'
            query={find.query}
            onQueryChange={find.setQuery}
            inputRef={find.inputRef}
            results={{ index: find.currentIndex, count: find.count, truncated: find.truncated }}
            onStep={(direction) => (direction > 0 ? find.next() : find.prev())}
            onClose={find.close}
            replace={
              isEditable
                ? {
                    value: find.replacement,
                    onChange: find.setReplacement,
                    onReplace: find.replaceCurrent,
                    onReplaceAll: find.replaceAll,
                    replaceAllDisabledReason: find.truncated
                      ? 'Narrow the search to replace all'
                      : undefined,
                  }
                : undefined
            }
          />
        </div>
      )}
      <div ref={containerRef} className={styles.scroller} data-editable={isEditable || undefined}>
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
            const liveEditor = editorInstanceRef.current
            const anchor = pendingImageAnchorRef.current
            const range = liveEditor && anchor ? findImageUploadRange(liveEditor, anchor) : null
            if (liveEditor && anchor) removeImageUpload(liveEditor, anchor)
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
        <MarkdownStreamingContext value={isStreaming}>
          {showPlaceholder && placeholder && (
            <ReadOnlyPlaceholder
              content={placeholder.content}
              file={file}
              workspaceId={workspaceId}
            />
          )}
          <div className={styles.surface} hidden={showPlaceholder}>
            <EditorContent editor={editor} />
          </div>
        </MarkdownStreamingContext>
      </div>
    </div>
  )
}
