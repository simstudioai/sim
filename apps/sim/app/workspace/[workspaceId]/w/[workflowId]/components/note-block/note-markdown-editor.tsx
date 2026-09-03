'use client'

import { cn } from '@sim/emcn'
import type { NoteContentEditorProps } from '@sim/workflow-renderer'
import { RichMarkdownField } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/rich-markdown-field'
import { useNoteImageUpload } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/note-block/use-note-image-upload'

export const NOTE_EDITOR_PROSE_CLASS_NAME = [
  'min-h-full w-full text-current',
  /* The height the shared node chrome centres a checklist's checkbox against —
     the note's own line box, not the file editor's taller default. */
  '[--rich-markdown-line-height:1.25rem]',
  /* Mirrors NOTE_MARKDOWN_FLOW, the rhythm Streamdown paints in the read view.
     Tailwind's JIT only sees literal class strings, so this cannot be composed
     from that constant — the note view exports it, and the parity test pins the
     two together. Without it the editor falls back to the per-element margins
     and every block after the first sits ~12px higher than when viewing. */
  '[&_.ProseMirror]:space-y-4 [&_.ProseMirror>*:first-child]:mt-0 [&_.ProseMirror>*:last-child]:mb-0',
  '[&_.ProseMirror]:min-h-full [&_.ProseMirror]:break-words [&_.ProseMirror]:pt-0.5 [&_.ProseMirror]:pb-2 [&_.ProseMirror]:outline-hidden',
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
  /* The shared node chrome frames an image for a document surface — an 8px radius and a
     `--border` hairline. A note paints a coloured card and draws every other edge from
     `currentColor`, and its read view frames images this way, so matching here is what keeps the
     image from changing shape as editing opens. Sizing (`max-width`/`height: auto`) still comes
     from the shared chrome; only the frame is the note's. */
  '[&_.ProseMirror_img]:rounded-md [&_.ProseMirror_img]:border-0',
  '[&_.ProseMirror_strong]:font-semibold',
  '[&_.ProseMirror_em]:opacity-80',
  '[&_.ProseMirror_blockquote]:my-4 [&_.ProseMirror_blockquote]:border-current/25 [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:pl-4 [&_.ProseMirror_blockquote]:italic',
  '[&_.ProseMirror_table]:my-2 [&_.ProseMirror_table]:w-full [&_.ProseMirror_table]:border-collapse [&_.ProseMirror_table]:text-xs',
  '[&_.ProseMirror_th]:px-2 [&_.ProseMirror_th]:py-1 [&_.ProseMirror_th]:text-left [&_.ProseMirror_th]:font-semibold',
  '[&_.ProseMirror_td]:px-2 [&_.ProseMirror_td]:py-1 [&_.ProseMirror_td]:opacity-90',
  '[&_.ProseMirror_.is-editor-empty:first-child]:before:pointer-events-none [&_.ProseMirror_.is-editor-empty:first-child]:before:float-left [&_.ProseMirror_.is-editor-empty:first-child]:before:h-0 [&_.ProseMirror_.is-editor-empty:first-child]:before:text-current/55 [&_.ProseMirror_.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]',
].join(' ')

/**
 * The Note card's skin over the platform markdown field.
 *
 * Everything behind the surface — the TipTap extension set, frontmatter held
 * out-of-band, the round-trip safety gate and its raw-source fallback, the
 * formatting bar, `/` commands, markdown paste — is {@link RichMarkdownField}'s.
 * This module supplies the Note's own chrome: the type scale and per-colour
 * selection/caret tints, which have to match the Streamdown render underneath so
 * the card does not jump when editing opens, and the workspace it uploads into.
 *
 * Every field of {@link NoteContentEditorProps} is forwarded. A prop the view
 * passes and this skin quietly drops type-checks clean and fails silently on the
 * canvas, so `note-markdown-editor.test.tsx` pins the forwarding.
 */
export function NoteMarkdownEditor({
  value,
  selectionClassName,
  caretClassName,
  openedAt,
  onChange,
}: NoteContentEditorProps) {
  const uploadImage = useNoteImageUpload()

  return (
    <RichMarkdownField
      value={value}
      onChange={onChange}
      surface='bare'
      autoFocus
      autoFocusAt={openedAt}
      placeholder="Add note, or press '/' for commands…"
      proseClassName={cn(NOTE_EDITOR_PROSE_CLASS_NAME, selectionClassName)}
      editorClassName={caretClassName}
      uploadImage={uploadImage}
    />
  )
}
