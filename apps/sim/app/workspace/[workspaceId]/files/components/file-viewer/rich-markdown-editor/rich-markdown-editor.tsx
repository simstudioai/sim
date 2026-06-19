'use client'

import { memo, useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { EditorContent, useEditor } from '@tiptap/react'
import { cn } from '@/lib/core/utils/cn'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { useUploadWorkspaceFile } from '@/hooks/queries/workspace-files'
import type { SaveStatus } from '@/hooks/use-autosave'
import { PreviewPanel } from '../preview-panel'
import { PreviewLoadingFrame } from '../preview-shared'
import type { StreamingMode } from '../text-editor-state'
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
  streamingMode?: StreamingMode
  disableStreamingAutoScroll?: boolean
  previewContextKey?: string
}

/**
 * Inline WYSIWYG markdown editor (TipTap/ProseMirror) for markdown files — a single editing surface
 * (markdown transformed inline as you type), no raw/preview split. Owns the file lifecycle through a
 * single {@link useEditableFileContent} engine: while agent output streams in (and during the
 * post-stream reconcile) it shows the read-only {@link PreviewPanel} with autosave disabled, so the
 * editor never races the agent's server-side write. Once content is loaded and settled it mounts the
 * actual editor.
 *
 * The editor is mounted only once content is ready, and is keyed by file id — so the loaded markdown
 * is the editor's *initial* `content` (parsed at create time), not pushed in by a sync effect. That
 * keeps it robust to TipTap's strict-mode/SSR instance lifecycle: there is no content-sync effect to
 * race, so a freshly created (or strict-mode-recreated) editor is always born with the right document.
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
  streamingMode,
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
    streamingMode,
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

  if (isStreamInteractionLocked) {
    return (
      <PreviewPanel
        key={previewContextKey ? `${file.id}:${previewContextKey}` : file.id}
        content={content}
        mimeType={file.type}
        filename={file.name}
        workspaceId={workspaceId}
        fileKey={file.key}
        isStreaming
        disableAutoScroll={disableStreamingAutoScroll}
      />
    )
  }

  return (
    <LoadedRichMarkdownEditor
      key={file.id}
      file={file}
      workspaceId={workspaceId}
      initialContent={content}
      canEdit={canEdit}
      autoFocus={autoFocus}
      onChange={setDraftContent}
      onSaveShortcut={saveImmediately}
    />
  )
})

interface LoadedRichMarkdownEditorProps {
  file: WorkspaceFileRecord
  workspaceId: string
  initialContent: string
  canEdit: boolean
  autoFocus?: boolean
  onChange: (markdown: string) => void
  onSaveShortcut: () => Promise<void>
}

/**
 * The mounted TipTap editor. Receives the file's loaded markdown as {@link initialContent} and hands
 * it to {@link useEditor} as the initial document (parsed at create time by the markdown extension),
 * so there is no imperative content sync. Frontmatter is held aside and re-applied on every change,
 * so the editor only ever round-trips the body.
 */
function LoadedRichMarkdownEditor({
  file,
  workspaceId,
  initialContent,
  canEdit,
  autoFocus,
  onChange,
  onSaveShortcut,
}: LoadedRichMarkdownEditorProps) {
  // Whether the opened content round-trips losslessly through the editor — computed once, on the
  // exact content the editor opens with (keyed by file id, so it remounts per file), and locked for
  // the editor's lifetime. A round-trip-unsafe document (raw HTML, footnotes, >128KB, …) opens
  // read-only so an edit can't corrupt it; a safe one stays editable. It is never re-derived: a
  // dirty document is round-trip-safe by construction (the editor only emits safe markdown), so
  // flipping editability off mid-edit would only strand unsaved edits (autosave, ⌘S, the toolbar
  // Save, and the unmount flush all gate on it).
  const roundTripSafeRef = useRef<boolean | null>(null)
  if (roundTripSafeRef.current === null) {
    roundTripSafeRef.current = isRoundTripSafe(initialContent)
  }
  const isEditable = canEdit && roundTripSafeRef.current

  // Split frontmatter off once, on the opened content (stable for the editor's lifetime, like the
  // verdict above): the body seeds the editor's initial document, and the frontmatter is re-attached
  // on every change so the editor only ever round-trips the body.
  const splitRef = useRef<{ frontmatter: string; body: string } | null>(null)
  if (splitRef.current === null) {
    splitRef.current = splitFrontmatter(initialContent)
  }
  const { frontmatter, body } = splitRef.current
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onSaveShortcutRef = useRef(onSaveShortcut)
  onSaveShortcutRef.current = onSaveShortcut

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
    autofocus: autoFocus ? 'end' : false,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    content: body,
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
      onChangeRef.current(applyFrontmatter(frontmatter, md))
    },
  })
  editorInstanceRef.current = editor

  useEffect(() => {
    editor?.setEditable(isEditable)
  }, [editor, isEditable])

  return (
    <div className={cn('flex flex-1 flex-col overflow-y-auto', isEditable && 'cursor-text')}>
      {editor && <EditorBubbleMenu editor={editor} />}
      <EditorContent
        editor={editor}
        className='mx-auto flex w-full max-w-[48rem] flex-1 flex-col px-8 py-6 selection:bg-[var(--selection-bg)] selection:text-[var(--text-primary)] dark:selection:bg-[var(--selection-dark)] dark:selection:text-white'
      />
    </div>
  )
}
