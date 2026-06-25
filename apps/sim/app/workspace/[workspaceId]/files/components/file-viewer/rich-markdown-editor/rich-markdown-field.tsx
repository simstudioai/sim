'use client'

import { useEffect, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { chipFieldSurfaceClass } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { createMarkdownEditorExtensions } from './extensions'
import {
  applyFrontmatter,
  postProcessSerializedMarkdown,
  splitFrontmatter,
} from './markdown-fidelity'
import { parseMarkdownToDoc } from './markdown-parse'
import { useEditorMentions } from './mention'
import { EditorBubbleMenu } from './menus/bubble-menu'
import { LinkHoverCard } from './menus/link-hover-card'
import { normalizeMarkdownContent } from './normalize-content'
import '@/components/emcn/components/code/code.css'
import './rich-markdown-editor.css'

interface RichMarkdownFieldProps {
  /** Current markdown value. Seeds the editor once on mount; external changes only apply while {@link isStreaming}. */
  value: string
  /** Fires with the serialized markdown on every local edit. */
  onChange: (markdown: string) => void
  placeholder?: string
  /** Renders the editor read-only (e.g. while saving). */
  disabled?: boolean
  /** True while `value` is being pushed in externally (AI generation) — the editor turns read-only and mirrors each update. */
  isStreaming?: boolean
  autoFocus?: boolean
  /** Min height of the scroll box in px. */
  minHeight?: number
  /** Max height of the scroll box in px before it scrolls. */
  maxHeight?: number
  /** Swaps the border to the error token (the message itself is rendered by the surrounding field). */
  error?: boolean
  /** Enables the `@` mention menu scoped to this workspace. Omit to disable mentions. */
  workspaceId?: string
  /**
   * Intercepts a plain-text paste before the editor handles it. Return `true` to consume the paste
   * (e.g. a full document the host destructures elsewhere); `false` to fall through to normal
   * markdown paste.
   */
  onPasteText?: (text: string) => boolean
}

/**
 * A controlled, string-valued WYSIWYG markdown editor for modal fields — the file-less sibling of
 * {@link RichMarkdownEditor}. It reuses the same TipTap extensions, parser, and menus but owns no file
 * loading, autosave, or image upload. Drop it inside a `ChipModalField type='custom'`.
 */
export function RichMarkdownField({
  value,
  onChange,
  placeholder = "Write something, or press '/' for commands…",
  disabled = false,
  isStreaming = false,
  autoFocus = false,
  minHeight = 140,
  maxHeight = 360,
  error = false,
  workspaceId,
  onPasteText,
}: RichMarkdownFieldProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Frontmatter is held out-of-band and re-attached on serialize, exactly like the file editor.
  // Split once at mount — the refs and the seed doc all derive from the initial value.
  const [initialSplit] = useState(() => splitFrontmatter(value))
  const frontmatterRef = useRef(initialSplit.frontmatter)
  // The body last reflected into the editor — updated on local edits and on each streamed sync.
  const lastSyncedBodyRef = useRef(initialSplit.body)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onPasteTextRef = useRef(onPasteText)
  onPasteTextRef.current = onPasteText

  // The original value verbatim, plus its canonical serialization. The editor only ever emits canonical
  // markdown, so an already-non-canonical input would re-serialize on mount and read as an unsaved edit;
  // reporting the original when the doc matches its canonical form keeps the field clean until a real edit.
  const initialValueRef = useRef(value)
  const [canonicalSeed] = useState(() => normalizeMarkdownContent(value))

  // TipTap extensions are stateful — build them once per mount so each field gets its own placeholder.
  const [extensions] = useState(() => createMarkdownEditorExtensions({ placeholder }))
  const [initialContent] = useState<JSONContent>(() => parseMarkdownToDoc(initialSplit.body))

  const editor = useEditor({
    extensions,
    editable: !disabled && !isStreaming,
    autofocus: autoFocus ? 'end' : false,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    content: initialContent,
    editorProps: {
      attributes: { class: 'rich-markdown-prose rich-markdown-field-prose' },
      handlePaste: (_view, event) => {
        const handler = onPasteTextRef.current
        if (!handler) return false
        const text = event.clipboardData?.getData('text/plain')
        if (!text) return false
        return handler(text)
      },
    },
    onUpdate: ({ editor }) => {
      const md = postProcessSerializedMarkdown(editor.getMarkdown())
      lastSyncedBodyRef.current = md
      const serialized = applyFrontmatter(frontmatterRef.current, md)
      onChangeRef.current(serialized === canonicalSeed ? initialValueRef.current : serialized)
    },
  })

  // Mirror an externally-driven value (AI generation) into the editor, then settle to editable.
  const wasStreamingRef = useRef(isStreaming)
  useEffect(() => {
    if (!editor) return
    const { frontmatter, body } = splitFrontmatter(value)
    frontmatterRef.current = frontmatter

    if (isStreaming) {
      wasStreamingRef.current = true
      if (editor.isEditable) editor.setEditable(false)
      if (body === lastSyncedBodyRef.current) return
      lastSyncedBodyRef.current = body
      const el = containerRef.current
      const pinnedToBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 60 : false
      editor.commands.setContent(parseMarkdownToDoc(body), {
        contentType: 'json',
        emitUpdate: false,
      })
      if (el && pinnedToBottom) el.scrollTop = el.scrollHeight
      return
    }

    // Settle: re-seed the freshly-generated body once, then restore editability.
    if (wasStreamingRef.current) {
      wasStreamingRef.current = false
      if (body !== lastSyncedBodyRef.current) {
        lastSyncedBodyRef.current = body
        editor.commands.setContent(parseMarkdownToDoc(body), {
          contentType: 'json',
          emitUpdate: false,
        })
      }
    }
    if (editor.isEditable !== !disabled) editor.setEditable(!disabled)
  }, [editor, value, isStreaming, disabled])

  useEditorMentions(editor, workspaceId)

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex flex-col overflow-y-auto px-3 py-2',
        chipFieldSurfaceClass,
        error && 'border-[var(--text-error)]',
        !disabled && !isStreaming && 'cursor-text'
      )}
      style={{ minHeight, maxHeight }}
    >
      {editor && <EditorBubbleMenu editor={editor} scrollContainerRef={containerRef} />}
      {editor && <LinkHoverCard editor={editor} />}
      <EditorContent
        editor={editor}
        className='flex flex-1 flex-col selection:bg-[var(--selection-bg)] selection:text-[var(--text-primary)] dark:selection:bg-[var(--selection-dark)] dark:selection:text-white'
      />
    </div>
  )
}
