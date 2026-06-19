'use client'

import { memo, useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { EditorContent, useEditor } from '@tiptap/react'
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
}

/**
 * Inline WYSIWYG markdown editor (TipTap/ProseMirror) for markdown files. Renders a
 * single editing surface — markdown is transformed inline as you type — with no raw/preview
 * split. Content loading and autosave are delegated to
 * {@link useEditableFileContent}; this component only renders the editor and bridges
 * markdown in and out of it.
 */
export const RichMarkdownEditor = memo(function RichMarkdownEditor({
  file,
  workspaceId,
  canEdit,
  autoFocus,
  onDirtyChange,
  onSaveStatusChange,
  saveRef,
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
    onDirtyChange,
    onSaveStatusChange,
    saveRef,
  })

  const isEditable = canEdit && !isStreamInteractionLocked

  const syncedMarkdownRef = useRef<string | null>(null)
  const frontmatterRef = useRef('')
  const frontmatterSourceRef = useRef<string | null>(null)
  const hasAutoFocusedRef = useRef(false)
  const setDraftContentRef = useRef(setDraftContent)
  setDraftContentRef.current = setDraftContent
  const saveImmediatelyRef = useRef(saveImmediately)
  saveImmediatelyRef.current = saveImmediately

  const uploadFile = useUploadWorkspaceFile()
  const editorInstanceRef = useRef<Editor | null>(null)

  /**
   * Upload each image to the workspace, then insert it at `at` (paste = caret, drop = cursor
   * under the pointer). Sequential so multiple images stack in order; the upload hook surfaces
   * its own success/error toasts, so a failed upload is skipped without interrupting the rest.
   * Held in a ref (reassigned each render) so the once-built `editorProps` handlers always reach
   * the latest workspace/file values.
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

  if (content !== frontmatterSourceRef.current) {
    frontmatterSourceRef.current = content
    frontmatterRef.current = splitFrontmatter(content).frontmatter
  }

  const editor = useEditor({
    extensions: EXTENSIONS,
    editable: isEditable,
    autofocus: autoFocus ? 'end' : false,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'rich-markdown-prose' },
      handleKeyDown: (_view, event) => {
        const isSaveShortcut = (event.metaKey || event.ctrlKey) && event.key?.toLowerCase() === 's'
        if (!isSaveShortcut) return false
        event.preventDefault()
        void saveImmediatelyRef.current()
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
        const images = extractImageFiles(event.clipboardData)
        if (images.length === 0) return false
        event.preventDefault()
        void insertImagesRef.current(images, view.state.selection.from)
        return true
      },
      handleDrop: (view, event) => {
        const images = extractImageFiles(event.dataTransfer)
        if (images.length === 0) return false
        event.preventDefault()
        const dropPos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        void insertImagesRef.current(images, dropPos ?? view.state.selection.from)
        return true
      },
    },
    onUpdate: ({ editor }) => {
      const body = postProcessSerializedMarkdown(editor.getMarkdown())
      const full = applyFrontmatter(frontmatterRef.current, body)
      syncedMarkdownRef.current = full
      setDraftContentRef.current(full)
    },
  })

  useEffect(() => {
    editorInstanceRef.current = editor
  }, [editor])

  useEffect(() => {
    editor?.setEditable(isEditable)
  }, [editor, isEditable])

  useEffect(() => {
    if (!editor || content === syncedMarkdownRef.current) return
    syncedMarkdownRef.current = content
    editor
      .chain()
      .setMeta('addToHistory', false)
      .setContent(splitFrontmatter(content).body, { contentType: 'markdown', emitUpdate: false })
      .run()
    if (autoFocus && !hasAutoFocusedRef.current) {
      hasAutoFocusedRef.current = true
      editor.commands.focus('end')
    }
  }, [editor, content, autoFocus])

  if (isContentLoading) return <PreviewLoadingFrame className='flex flex-1 flex-col' />

  if (hasContentError) {
    return (
      <div className='flex flex-1 items-center justify-center'>
        <p className='text-[var(--text-muted)] text-small'>Failed to load file content</p>
      </div>
    )
  }

  return (
    <div className='flex flex-1 cursor-text flex-col overflow-y-auto'>
      {editor && <EditorBubbleMenu editor={editor} />}
      <EditorContent
        editor={editor}
        className='mx-auto flex w-full max-w-[48rem] flex-1 flex-col px-8 py-6 selection:bg-[var(--selection-bg)] selection:text-[var(--text-primary)] dark:selection:bg-[var(--selection-dark)] dark:selection:text-white'
      />
    </div>
  )
})
