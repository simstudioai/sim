'use client'

import { type ClipboardEvent, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@sim/emcn/lib/cn'
import { formatPasteLimit, PASTE_LIMITS } from '@sim/utils/paste'
import { toast } from '@/lib/toast/sink'
import { RichMarkdownField } from '@/app/(product)/workspace/[workspaceId]/_components/rich-markdown-editor/rich-markdown-field'
import type { NoteContentEditorProps } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/canvas/note-block/note-block'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/canvas/note-block/note-markdown-editor.module.css'
import { useNoteImageUpload } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/canvas/note-block/use-note-image-upload'
import { assessRawMarkdownPaste, isRoundTripSafe } from '@/platform/lib/data/workflows'

const NOTE_EDITOR_PLACEHOLDER = "Add note, or press '/' for commands…"

function warnRichMarkdownPasteLimit() {
  toast.warning('Paste is too large for rich-text editing', {
    description: `Keep this document under ${formatPasteLimit(PASTE_LIMITS.RICH_MARKDOWN_BYTES)}, or import the content as a file.`,
  })
}

/**
 * Raw-text fallback for content the rich editor can't round-trip losslessly — editing the markdown
 * source directly so an edit can't silently drop footnotes, raw HTML, or comments. A plain textarea
 * inheriting the card's colour, growing with its content.
 */
function RawNoteMarkdownField({
  value,
  onChange,
  placeholder,
  proseClassName,
}: {
  value: string
  onChange: (markdown: string) => void
  placeholder: string
  proseClassName: string
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  /**
   * A textarea has no intrinsic auto-height, so the height is synced to `scrollHeight` on every value
   * change and whenever the element resizes (a width change re-wraps lines without touching `value`).
   */
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return

    const measure = () => {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [value])

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = event.clipboardData.getData('text/plain')
    if (!text) return

    const admission = assessRawMarkdownPaste({
      pastedText: text,
      currentText: value,
      selectionStart: event.currentTarget.selectionStart,
      selectionEnd: event.currentTarget.selectionEnd,
    })
    if (admission.accepted) return

    event.preventDefault()
    warnRichMarkdownPasteLimit()
  }

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onPaste={handlePaste}
      data-paste-max-bytes={PASTE_LIMITS.RICH_MARKDOWN_BYTES}
      placeholder={placeholder}
      className={cn(styles.rawSource, styles.rawSourceGrow, proseClassName)}
    />
  )
}

/**
 * The Note card's markdown editor. Round-trip-safe content opens in the shared rich markdown field,
 * with the `/` menu, formatting bar, table bar, link hover card, resizable images and code-block
 * language picker the legacy Note has; lossy markdown (raw HTML, footnotes, comments) falls back to
 * raw-source editing, decided once from the initial value, so an edit can't silently drop those
 * constructs. The wrapper supplies the Note's own type scale and per-colour selection and caret tints,
 * which match the read view underneath so the card does not jump when editing opens. The field's bars
 * open on the Platform surface, since the card clips its own overflow.
 */
export function NoteMarkdownEditor({
  value,
  selectionClassName,
  caretClassName,
  openedAt,
  onChange,
}: NoteContentEditorProps) {
  const uploadImage = useNoteImageUpload()
  const [isSafe] = useState(() => isRoundTripSafe(value))
  const proseClassName = cn(styles.prose, selectionClassName)

  return isSafe ? (
    <div className={cn(proseClassName, caretClassName)}>
      <RichMarkdownField
        value={value}
        onChange={onChange}
        placeholder={NOTE_EDITOR_PLACEHOLDER}
        autoFocusAt={openedAt}
        uploadImage={uploadImage}
        menuLayer='surface'
      />
    </div>
  ) : (
    <RawNoteMarkdownField
      value={value}
      onChange={onChange}
      placeholder={NOTE_EDITOR_PLACEHOLDER}
      proseClassName={proseClassName}
    />
  )
}
