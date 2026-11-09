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
import { InlineNotice } from '@sim/emcn/status'
import { PASTE_LIMITS, PASTE_RENDER_THRESHOLDS, utf8ByteLength } from '@sim/utils/paste'
import type { Extensions, JSONContent, Range } from '@tiptap/core'
import { isChangeOrigin } from '@tiptap/extension-collaboration'
import type { Editor } from '@tiptap/react'
import { EditorContent, useEditor } from '@tiptap/react'
import { useRouter } from 'next/navigation'
import { toast } from '@/lib/toast/sink'
import { FindBar } from '@/app/(product)/_components/find-bar/find-bar'
import { EditorBubbleMenu } from '@/app/(product)/workspace/[workspaceId]/_components/rich-markdown-editor/bubble-menu'
import { createMarkdownEditorExtensions } from '@/app/(product)/workspace/[workspaceId]/_components/rich-markdown-editor/editor-extensions'
import {
  beginImageUploads,
  findImageUpload,
  findImageUploadRange,
  finishImageUpload,
  removeImageUpload,
} from '@/app/(product)/workspace/[workspaceId]/_components/rich-markdown-editor/image-upload'
import { LinkHoverCard } from '@/app/(product)/workspace/[workspaceId]/_components/rich-markdown-editor/link-hover-card'
import { TableBubbleMenu } from '@/app/(product)/workspace/[workspaceId]/_components/rich-markdown-editor/table-menu'
import { useEditorMentions } from '@/app/(product)/workspace/[workspaceId]/_components/rich-markdown-editor/use-editor-mentions'
import { useReportFileDocPeers } from '@/app/(product)/workspace/[workspaceId]/files/_components/file-viewer/collaboration/file-doc-room'
import { FileSaveConflict } from '@/app/(product)/workspace/[workspaceId]/files/_components/file-viewer/file-save-conflict'
import { PreviewError } from '@/app/(product)/workspace/[workspaceId]/files/_components/file-viewer/preview-shared'
import styles from '@/app/(product)/workspace/[workspaceId]/files/_components/file-viewer/rich-markdown-editor/rich-markdown-editor.module.css'
import { useMarkdownFind } from '@/app/(product)/workspace/[workspaceId]/files/_components/file-viewer/rich-markdown-editor/use-markdown-find'
import { TextEditor } from '@/app/(product)/workspace/[workspaceId]/files/_components/file-viewer/text-editor'
import type { FileEditingProps } from '@/app/(product)/workspace/[workspaceId]/files/_components/file-viewer/types'
import {
  buildFileSelectionLabel,
  type ChatContext,
  type FileDownloadSource,
  truncateSelectionText,
  useAddToChat,
  useEditableFileContent,
  useFileContentSource,
  useSelectionCopyBridge,
  type WorkspaceFileRecord,
} from '@/platform/lib/data/files'
import {
  FILE_DOC_SEED,
  isCollabReady,
  useFileDocCollaboration,
} from '@/platform/lib/data/files/collaboration'
import {
  applyFrontmatter,
  extractImageFiles,
  firstHeadingTitle,
  getImageFileFallback,
  type ImageFileFallback,
  isPlainTextPaste,
  isRoundTripSafe,
  isSelectionInLeadingHeading,
  isUntitledName,
  moveDraggedImageNode,
  normalizeLinkHref,
  normalizeMarkdownContent,
  normalizePastedImageSources,
  parseMarkdownToDoc,
  postProcessSerializedMarkdown,
  resolveImageFileFallback,
  scrollToHeading,
  splitFrontmatter,
  useMarkdownSession,
  useUploadWorkspaceFile,
} from '@/platform/lib/data/files/markdown'

const PLACEHOLDER = "Write something, or press '/' for commands…"

/** The shared extension set of the read-only preview shown while a shared document syncs. */
const PREVIEW_EXTENSIONS = createMarkdownEditorExtensions({ placeholder: PLACEHOLDER })

const UPLOAD_NOTICE_DURATION = 0

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
export const RichMarkdownEditor = memo(function RichMarkdownEditor({
  file,
  workspaceId,
  canEdit,
  autoFocus,
  onDirtyChange,
  onSaveStatusChange,
  saveRef,
  downloadSourceRef,
  discardRef,
  collaborative = false,
  onDeriveTitleFromHeading,
  enableFind = false,
}: RichMarkdownEditorProps) {
  const [sourceFileId, setSourceFileId] = useState<string | null>(null)
  if (sourceFileId === file.id)
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
        downloadSourceRef={downloadSourceRef}
        discardRef={discardRef}
      />
    )
  return (
    <RichMarkdownSurface
      file={file}
      workspaceId={workspaceId}
      canEdit={canEdit}
      autoFocus={autoFocus}
      onDirtyChange={onDirtyChange}
      onSaveStatusChange={onSaveStatusChange}
      saveRef={saveRef}
      downloadSourceRef={downloadSourceRef}
      discardRef={discardRef}
      collaborative={collaborative}
      onDeriveTitleFromHeading={onDeriveTitleFromHeading}
      enableFind={enableFind}
      onEditSource={() => setSourceFileId(file.id)}
    />
  )
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
  collaborative = false,
  onDeriveTitleFromHeading,
  enableFind = false,
  onEditSource,
}: RichMarkdownSurfaceProps) {
  const session = useMarkdownSession()
  const [canClientAutosave, setCanClientAutosave] = useState(!collaborative)
  const [collaborationReset, setCollaborationReset] = useState({ fileId: file.id, generation: 0 })
  const collaborationGeneration =
    collaborationReset.fileId === file.id ? collaborationReset.generation : 0
  const resetCollaboration = useCallback(() => {
    setCollaborationReset((previous) => ({
      fileId: file.id,
      generation: previous.fileId === file.id ? previous.generation + 1 : 1,
    }))
  }, [file.id])
  /** A relay older than read membership rejects a read-only member, who then reads locally. */
  const [localReadOnlyFileId, setLocalReadOnlyFileId] = useState<string | null>(null)
  const collaborationDeclined = !canEdit && localReadOnlyFileId === file.id
  const declineCollaboration = useCallback(() => setLocalReadOnlyFileId(file.id), [file.id])

  const {
    content,
    setDraftContent,
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
      key={`${file.id}:${collaborationDeclined ? 'local' : collaborationGeneration}`}
      recoveringCollaboration={collaborationGeneration > 0}
      onWriteAccessLost={resetCollaboration}
      onReadOnlyJoinRejected={declineCollaboration}
      file={file}
      workspaceId={workspaceId}
      content={content}
      acceptedBaselineContent={acceptedBaselineContent}
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
  const [settled, setSettled] = useState<SettledContent>(() =>
    lockSettled(recoveringCollaboration ? (acceptedBaselineContent ?? '') : content)
  )
  const [acceptedBaseline, setAcceptedBaseline] = useState(acceptedBaselineContent)
  /** TipTap fixes its extensions at creation, so collaboration cannot turn on later. */
  const [collaborationEnabled] = useState(
    () =>
      collaborative &&
      settled.verdict &&
      Boolean(userId) &&
      (file.storageContext ?? 'workspace') === 'workspace'
  )
  if (
    !collaborationEnabled &&
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
  const isEditable = effectiveCanEdit && settled.verdict && collabReady

  /** A shared document starts empty and fills from the server seed; a local one parses its source. */
  const [initialContent] = useState<JSONContent | string>(() =>
    collaborationEnabled ? '' : parseMarkdownToDoc(splitFrontmatter(content).body)
  )
  const [placeholder] = useState(() => {
    if (!collaborationEnabled) return null
    const markdown = recoveringCollaboration ? (acceptedBaselineContent ?? '') : content
    return { content: parseMarkdownToDoc(splitFrontmatter(markdown).body), markdown }
  })
  const lastSyncedBodyRef = useRef<string>(splitFrontmatter(content).body)
  const lastSyncedFrontmatterRef = useRef(settled.frontmatter)
  const onChangeRef = useRef(onChange)
  const onSaveShortcutRef = useRef(onSaveShortcut)

  /** A shared document's frontmatter lives in the CRDT, so a server edit to it is kept. */
  const resolveSaveFrontmatter = (): string => {
    const fromDoc = collaboration?.doc
      .getMap(FILE_DOC_SEED.configMap)
      .get(FILE_DOC_SEED.frontmatterKey)
    if (typeof fromDoc === 'string') return fromDoc
    return settled.frontmatter
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
          if (!collaboration) return lastSyncedBodyRef.current
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
    autofocus: autoFocus ? 'end' : false,
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
   * A local document follows its accepted source: a reload after a conflict or an outside write
   * replaces the body, and editability tracks permission and the round-trip verdict. View changes
   * run on a microtask, after commit, and only the latest run applies.
   */
  const syncRunRef = useRef(0)
  useEffect(() => {
    if (!editor || collaborationEnabled) return
    const run = ++syncRunRef.current
    queueMicrotask(() => {
      if (run !== syncRunRef.current || editor.isDestroyed) return
      const { body, frontmatter } = splitFrontmatter(content)
      lastSyncedFrontmatterRef.current = frontmatter
      if (body !== lastSyncedBodyRef.current) {
        lastSyncedBodyRef.current = body
        editor.commands.setContent(parseMarkdownToDoc(body), {
          contentType: 'json',
          emitUpdate: false,
        })
      }
      editor.setEditable(effectiveCanEdit && settled.verdict && collabReady)
    })
  }, [editor, content, settled, effectiveCanEdit, collaborationEnabled, collabReady])

  const addToChat = useAddToChat()
  const buildSelectionContext = useCallback(
    () => buildEditorSelectionContext(editor, { id: file.id, name: file.name }),
    [editor, file.id, file.name]
  )
  const handleAddSelectionToChat = () => {
    const context = buildSelectionContext()
    if (context) addToChat(context)
  }

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
      editor && settled.canExportSnapshot
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
      settled.canExportSnapshot,
    ]
  )

  useSelectionCopyBridge(containerRef, buildSelectionContext, workspaceId, !showPlaceholder)

  /** Find waits for the seed: the placeholder's text is not in the live editor yet. */
  const find = useMarkdownFind({ editor, enabled: enableFind && !showPlaceholder })

  const needsSource = canEdit && !settled.verdict
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
      </div>
    </div>
  )
}
