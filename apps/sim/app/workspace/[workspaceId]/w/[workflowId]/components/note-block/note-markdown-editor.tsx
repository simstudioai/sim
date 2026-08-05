'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import type { JSONContent } from '@tiptap/core'
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor } from '@tiptap/react'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import { postProcessSerializedMarkdown } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'
import { parseMarkdownToDoc } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-parse'

interface NoteMarkdownEditorProps {
  value: string
  selectionClassName: string
  onChange: (content: string) => void
  onBlur: () => void
  onCancel: () => void
}

const NOTE_EDITOR_PROSE_CLASS_NAME = [
  'min-h-full w-full text-current',
  '[&_.ProseMirror]:min-h-full [&_.ProseMirror]:break-words [&_.ProseMirror]:pt-0.5 [&_.ProseMirror]:pb-2 [&_.ProseMirror]:outline-none',
  '[&_.ProseMirror_p]:mb-1 [&_.ProseMirror_p]:text-sm [&_.ProseMirror_p]:leading-[1.25rem] [&_.ProseMirror_p:last-child]:mb-0',
  '[&_.ProseMirror_h1]:mt-3 [&_.ProseMirror_h1]:mb-3 [&_.ProseMirror_h1]:font-semibold [&_.ProseMirror_h1]:text-lg [&_.ProseMirror_h1:first-child]:mt-0',
  '[&_.ProseMirror_h2]:mt-2.5 [&_.ProseMirror_h2]:mb-2.5 [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:text-base [&_.ProseMirror_h2:first-child]:mt-0',
  '[&_.ProseMirror_h3]:mt-2 [&_.ProseMirror_h3]:mb-2 [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_h3]:text-sm [&_.ProseMirror_h3:first-child]:mt-0',
  '[&_.ProseMirror_h4]:mt-2 [&_.ProseMirror_h4]:mb-2 [&_.ProseMirror_h4]:font-semibold [&_.ProseMirror_h4]:text-xs [&_.ProseMirror_h4:first-child]:mt-0',
  '[&_.ProseMirror_ul]:mt-1 [&_.ProseMirror_ul]:mb-1 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:space-y-1 [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ul]:text-sm',
  '[&_.ProseMirror_ol]:mt-1 [&_.ProseMirror_ol]:mb-1 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:space-y-1 [&_.ProseMirror_ol]:pl-6 [&_.ProseMirror_ol]:text-sm',
  '[&_.ProseMirror_li]:break-words [&_.ProseMirror_li>p]:mb-0',
  '[&_.ProseMirror_code]:whitespace-normal [&_.ProseMirror_code]:rounded [&_.ProseMirror_code]:bg-black/10 [&_.ProseMirror_code]:px-1 [&_.ProseMirror_code]:py-0.5 [&_.ProseMirror_code]:font-mono [&_.ProseMirror_code]:text-xs',
  '[&_.ProseMirror_pre]:my-2 [&_.ProseMirror_pre]:whitespace-pre-wrap [&_.ProseMirror_pre]:break-words [&_.ProseMirror_pre]:rounded [&_.ProseMirror_pre]:bg-black/15 [&_.ProseMirror_pre]:p-2 [&_.ProseMirror_pre]:text-xs',
  '[&_.ProseMirror_pre_code]:block [&_.ProseMirror_pre_code]:bg-transparent [&_.ProseMirror_pre_code]:p-0',
  '[&_.ProseMirror_a]:break-all [&_.ProseMirror_a]:font-medium [&_.ProseMirror_a]:underline [&_.ProseMirror_a]:underline-offset-2',
  '[&_.ProseMirror_strong]:font-semibold',
  '[&_.ProseMirror_em]:opacity-80',
  '[&_.ProseMirror_blockquote]:my-4 [&_.ProseMirror_blockquote]:border-current/25 [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:pl-4 [&_.ProseMirror_blockquote]:italic',
  '[&_.ProseMirror_table]:my-2 [&_.ProseMirror_table]:w-full [&_.ProseMirror_table]:border-collapse [&_.ProseMirror_table]:text-xs',
  '[&_.ProseMirror_th]:px-2 [&_.ProseMirror_th]:py-1 [&_.ProseMirror_th]:text-left [&_.ProseMirror_th]:font-semibold',
  '[&_.ProseMirror_td]:px-2 [&_.ProseMirror_td]:py-1 [&_.ProseMirror_td]:opacity-90',
  '[&_.ProseMirror_.is-editor-empty:first-child]:before:pointer-events-none [&_.ProseMirror_.is-editor-empty:first-child]:before:float-left [&_.ProseMirror_.is-editor-empty:first-child]:before:h-0 [&_.ProseMirror_.is-editor-empty:first-child]:before:text-current/55 [&_.ProseMirror_.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]',
].join(' ')

/** WYSIWYG markdown editing surface styled to match the rendered Note exactly. */
export function NoteMarkdownEditor({
  value,
  selectionClassName,
  onChange,
  onBlur,
  onCancel,
}: NoteMarkdownEditorProps) {
  const onChangeRef = useRef(onChange)
  const onBlurRef = useRef(onBlur)
  const onCancelRef = useRef(onCancel)
  const lastEmittedValueRef = useRef(value)
  onChangeRef.current = onChange
  onBlurRef.current = onBlur
  onCancelRef.current = onCancel
  const [extensions] = useState(() => [
    ...createMarkdownContentExtensions(),
    Placeholder.configure({ placeholder: 'Add note…' }),
  ])
  const [initialContent] = useState<JSONContent>(() => parseMarkdownToDoc(value))

  const editor = useEditor({
    extensions,
    content: initialContent,
    autofocus: 'end',
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: 'min-h-full outline-none',
      },
      handleKeyDown: (_view, event) => {
        if (event.key !== 'Escape' && !(event.key === 'Enter' && event.metaKey)) return false
        event.preventDefault()
        onCancelRef.current()
        return true
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      const nextValue = postProcessSerializedMarkdown(currentEditor.getMarkdown())
      lastEmittedValueRef.current = nextValue
      onChangeRef.current(nextValue)
    },
    onBlur: () => onBlurRef.current(),
  })

  useEffect(() => {
    if (!editor || value === lastEmittedValueRef.current) return
    lastEmittedValueRef.current = value
    editor.commands.setContent(parseMarkdownToDoc(value), {
      contentType: 'json',
      emitUpdate: false,
    })
  }, [editor, value])

  return (
    <EditorContent
      editor={editor}
      className={cn('min-h-full w-full', NOTE_EDITOR_PROSE_CLASS_NAME, selectionClassName)}
    />
  )
}
