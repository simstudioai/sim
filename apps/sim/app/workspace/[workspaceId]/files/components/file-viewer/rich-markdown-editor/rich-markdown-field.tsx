'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChipTextarea, chipFieldSurfaceClass, cn, toast } from '@sim/emcn'
import { formatPasteLimit, PASTE_LIMITS } from '@sim/utils/paste'
import type { JSONContent, Range } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { createMarkdownEditorExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/editor-extensions'
import { moveDraggedImageNode } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-drag-move'
import {
  extractImageFiles,
  getImageFileFallback,
  type ImageFileFallback,
  normalizePastedImageSources,
  resolveImageFileFallback,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-paste'
import {
  beginImageUploads,
  findImageUpload,
  finishImageUpload,
  removeImageUpload,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-upload'
import {
  applyFrontmatter,
  postProcessSerializedMarkdown,
  splitFrontmatter,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'
import { parseMarkdownToDoc } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-parse'
import { isPlainTextPaste } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-paste'
import { useEditorMentions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/mention'
import { EditorBubbleMenu } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/bubble-menu'
import { LinkHoverCard } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/link-hover-card'
import { normalizeMarkdownContent } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/normalize-content'
import { assessRawMarkdownPaste } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/paste-admission'
import { isRoundTripSafe } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/round-trip-safety'
import '@sim/emcn/components/code/code.css'
import '@/app/workspace/[workspaceId]/files/components/file-viewer/document-table.css'
import '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/rich-markdown-editor.css'

/**
 * Sends the formatting toolbar back to its body portal instead of anchoring it inside the editor's
 * container.
 *
 * A field or a full page gives the toolbar a bounded pane to sit in and scroll with, and being
 * clipped at that pane's edge is the point. A bare host has no such pane — the canvas Note card is
 * 320px wide and clips its own overflow, so an in-card toolbar would be cropped to a stub. A null
 * container is how {@link EditorBubbleMenu} spells "portal to the body".
 */
const BODY_PORTAL: React.RefObject<HTMLDivElement | null> = { current: null }

function warnRichMarkdownPasteLimit() {
  toast.warning('Paste is too large for rich-text editing', {
    description: `Keep this document under ${formatPasteLimit(PASTE_LIMITS.RICH_MARKDOWN_BYTES)}, or import the content as a file.`,
  })
}

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
  /**
   * Viewport point to place the caret at on mount, instead of the document end.
   * For hosts whose read view sits under a click-to-edit overlay: the overlay
   * consumes the click that opens editing, so without the point the caret can
   * only land at the end and the user's aim is lost.
   */
  autoFocusAt?: { clientX: number; clientY: number } | null
  /** Min height of the editor box in px. */
  minHeight?: number
  /**
   * Max height in px before the box scrolls internally. Set this inside a modal,
   * where the surface itself cannot grow. Omit on a full-page surface so the
   * editor grows with its content and the page owns the only scrollbar — a
   * capped box stranded above empty page is worse than a long document.
   */
  maxHeight?: number
  /** Swaps the border to the error token (the message itself is rendered by the surrounding field). */
  error?: boolean
  /** Enables the `@` mention menu scoped to this workspace. Omit to disable mentions. */
  workspaceId?: string
  /** Force the `@` tag-insertion menu off even with a workspace set (existing tags still render). */
  disableTagging?: boolean
  /**
   * Uploads a pasted or dropped image and returns its hosted URL, or null on
   * failure. Providing this enables image paste/drop; without it, file drops
   * are swallowed so the browser cannot navigate to the dropped file. The
   * expected implementation is the workspace-file pipeline — the same
   * presigned-S3 upload and `/api/workspaces/{id}/files/inline` URL shape the
   * file editor persists — so every embedded image stays behind workspace
   * auth and inside the existing storage lifecycle.
   */
  uploadImage?: (file: File) => Promise<{ url: string; alt: string } | null>
  /**
   * Intercepts a plain-text paste before the editor handles it. Return `true` to consume the paste
   * (e.g. a full document the host destructures elsewhere); `false` to fall through to normal
   * markdown paste.
   */
  onPasteText?: (text: string) => boolean
  /**
   * Chrome around the editor.
   *
   * `'field'` is the bordered chip-field box every form surface uses. `'bare'`
   * drops the box, its padding and its default height so a host that already
   * owns a surface — the canvas Note card, which paints its own fill and text
   * colour — renders the editor inline instead of nesting a second field
   * inside it. Both surfaces get the same editor and the same floating menus.
   */
  surface?: 'field' | 'bare'
  /**
   * Typography for a `'bare'` surface, where the host owns the type scale and
   * colour. Ignored by `'field'`, which keeps the shared prose styling.
   */
  proseClassName?: string
  /**
   * Classes for the contenteditable root itself on a `'bare'` surface. Anything
   * that must beat a rule targeting that element directly belongs here rather
   * than in {@link proseClassName} — a global base rule pins `caret-color` on
   * `[contenteditable="true"]`, and a declaration on the element always beats a
   * value inherited from an ancestor, however specific that ancestor's is.
   */
  editorClassName?: string
}

/**
 * The WYSIWYG editor for round-trip-safe content (chosen by {@link RichMarkdownField}). The file-less
 * sibling of {@link RichMarkdownEditor}'s loaded editor: same TipTap extensions, parser, and menus but
 * no file loading or autosave.
 */
function LoadedRichMarkdownField({
  value,
  onChange,
  placeholder = "Write something, or press '/' for commands…",
  disabled = false,
  isStreaming = false,
  autoFocus = false,
  autoFocusAt = null,
  minHeight,
  maxHeight,
  error = false,
  workspaceId,
  disableTagging,
  onPasteText,
  uploadImage,
  surface = 'field',
  proseClassName,
  editorClassName,
}: RichMarkdownFieldProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const isBare = surface === 'bare'
  /* A field keeps its 140px floor; a bare surface is sized by its host. */
  const boxMinHeight = minHeight ?? (isBare ? undefined : 140)

  /**
   * Frontmatter is held out-of-band and re-attached on serialize, exactly like the file editor. Split
   * once at mount — the refs and the seed doc all derive from this initial value.
   */
  const [initialSplit] = useState(() => splitFrontmatter(value))
  const frontmatterRef = useRef(initialSplit.frontmatter)
  /** The body last reflected into the editor — updated on local edits and on each streamed sync. */
  const lastSyncedBodyRef = useRef(initialSplit.body)
  const onChangeRef = useRef(onChange)
  const onPasteTextRef = useRef(onPasteText)
  const uploadImageRef = useRef(uploadImage)
  const autoFocusAtRef = useRef(autoFocusAt)
  const editorInstanceRef = useRef<ReturnType<typeof useEditor>>(null)
  const uploadGenerationRef = useRef(0)

  /**
   * The `/Image` slash command opens this hidden picker; `pendingImagePosRef` holds the caret
   * position captured when the command ran, so the upload inserts where `/Image` was typed.
   */
  const imageInputRef = useRef<HTMLInputElement>(null)
  const pendingImagePosRef = useRef<number | null>(null)

  /**
   * Reuse the file editor's mapped anchors without adding upload chrome to embedded fields.
   * A streamed replacement invalidates the batch even if editing resumes before upload completes.
   */
  async function insertImages(images: File[], range: Range, fallback?: ImageFileFallback | null) {
    const upload = uploadImageRef.current
    const owner = editorInstanceRef.current
    if (!upload || !owner || owner.isDestroyed || !owner.isEditable) return
    const generation = uploadGenerationRef.current
    const anchors = beginImageUploads(
      owner,
      range,
      images.map(() => '')
    )
    const canInsert = () =>
      editorInstanceRef.current === owner &&
      !owner.isDestroyed &&
      owner.isEditable &&
      uploadGenerationRef.current === generation
    try {
      for (const [index, image] of images.entries()) {
        if (!canInsert()) break
        const anchor = anchors[index]
        if (!anchor || findImageUpload(owner, anchor) === null) continue
        const result = await upload(image).catch(() => null)
        if (!canInsert()) break
        if (result)
          finishImageUpload(
            owner,
            anchor,
            result.url,
            result.alt,
            fallback ? resolveImageFileFallback(fallback, result.url) : undefined
          )
        else removeImageUpload(owner, anchor)
      }
    } finally {
      for (const anchor of anchors) removeImageUpload(owner, anchor)
    }
  }

  /**
   * The original value verbatim, plus its canonical serialization. The editor only ever emits canonical
   * markdown, so an already-non-canonical input would re-serialize on mount and read as an unsaved edit;
   * reporting the original when the doc matches its canonical form keeps the field clean until a real edit.
   */
  const initialValueRef = useRef(value)
  const [canonicalSeed] = useState(() => normalizeMarkdownContent(value))

  /** TipTap extensions are stateful — build them once per mount so each field gets its own placeholder. */
  const [extensions] = useState(() =>
    createMarkdownEditorExtensions({
      placeholder,
      pasteAdmission: {
        maxResultBytes: PASTE_LIMITS.RICH_MARKDOWN_BYTES,
        getCurrentText: () => lastSyncedBodyRef.current,
        getFrontmatter: () => frontmatterRef.current,
        onRejected: warnRichMarkdownPasteLimit,
      },
    })
  )
  const [initialContent] = useState<JSONContent>(() => parseMarkdownToDoc(initialSplit.body))

  const editor = useEditor({
    extensions,
    editable: !disabled && !isStreaming,
    enablePasteRules: false,
    autofocus: autoFocusAt ? false : autoFocus ? 'end' : false,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    content: initialContent,
    editorProps: {
      attributes: {
        /*
         * `rich-markdown-nodes` carries the editor's node chrome and is not the
         * host's to own, so both surfaces take it. The prose classes pin the
         * field's ink and type ramp — `--text-primary` at 15px/25px, then
         * 14px/22px from the field layer — which a bare host supplies itself
         * (the Note card matches its rendered view via `proseClassName`), so on
         * that surface they would recolor the text and shift its metrics the
         * moment editing opens.
         */
        class: cn(
          'rich-markdown-nodes',
          isBare ? editorClassName : 'rich-markdown-prose rich-markdown-field-prose'
        ),
        // Claim ⌘K so the bubble-menu link editor wins over the global search palette.
        'data-owned-shortcuts': 'Mod+K',
        'data-paste-max-bytes': String(PASTE_LIMITS.RICH_MARKDOWN_BYTES),
        'data-paste-max-html-bytes': String(PASTE_LIMITS.RICH_MARKDOWN_BYTES),
        'data-paste-handles-images': uploadImage ? 'true' : 'false',
      },
      transformPasted: (slice, view) => normalizePastedImageSources(slice, view.state.doc),
      handlePaste: (view, event, slice) => {
        if (!view.editable) return false
        const currentEditor = editorInstanceRef.current
        if (currentEditor && isPlainTextPaste(currentEditor)) return false
        const images = uploadImageRef.current ? extractImageFiles(event.clipboardData) : []
        const clipboardHtml = event.clipboardData?.getData('text/html') ?? ''
        const fallback = getImageFileFallback(slice, images)
        if (images.length > 0 && (!clipboardHtml || !slice.content.size || fallback)) {
          event.preventDefault()
          void insertImages(images, view.state.selection, fallback)
          return true
        }
        const handler = onPasteTextRef.current
        if (!handler) return false
        const text = event.clipboardData?.getData('text/plain')
        if (!text) return false
        return handler(text)
      },
      handleDrop: (view, event, slice, moved) => {
        if (!view.editable) return false
        const html = event.dataTransfer?.getData('text/html') ?? ''
        const images = uploadImageRef.current ? extractImageFiles(event.dataTransfer) : []
        const uploadFallback = getImageFileFallback(slice, images)
        if (!uploadFallback && moveDraggedImageNode(view, event, slice, moved)) return true
        if (html && slice.content.size > 0 && !uploadFallback) return false
        if (event.dataTransfer?.files.length) {
          event.preventDefault()
          if (images.length > 0) {
            const dropPos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
            const at = dropPos ?? view.state.selection.from
            void insertImages(images, { from: at, to: at }, uploadFallback)
          }
          return true
        }
        return false
      },
    },
    /* Resolved after creation, not via `autofocus`: mapping a point to a
       document position needs the editor's DOM laid out. */
    onCreate: ({ editor }) => {
      const point = autoFocusAtRef.current
      if (!point) return
      const resolved = editor.view.posAtCoords({ left: point.clientX, top: point.clientY })
      editor.commands.focus(resolved ? resolved.pos : 'end')
    },
    onUpdate: ({ editor }) => {
      const md = postProcessSerializedMarkdown(editor.getMarkdown())
      lastSyncedBodyRef.current = md
      const serialized = applyFrontmatter(frontmatterRef.current, md)
      onChangeRef.current(serialized === canonicalSeed ? initialValueRef.current : serialized)
    },
  })

  useLayoutEffect(() => {
    onChangeRef.current = onChange
    onPasteTextRef.current = onPasteText
    uploadImageRef.current = uploadImage
  }, [onChange, onPasteText, uploadImage])

  /** React can unmount the field before TipTap's deferred destruction runs. */
  useLayoutEffect(() => {
    editorInstanceRef.current = editor
    return () => {
      editorInstanceRef.current = null
    }
  }, [editor])

  /** Mirrors an externally-driven value (AI generation) into the editor, then settles to editable. */
  const wasStreamingRef = useRef(isStreaming)
  useEffect(() => {
    if (!editor) return
    const { frontmatter, body } = splitFrontmatter(value)
    frontmatterRef.current = frontmatter

    if (isStreaming) {
      if (!wasStreamingRef.current) uploadGenerationRef.current++
      wasStreamingRef.current = true
      if (editor.isEditable) editor.setEditable(false, false)
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
    if (editor.isEditable !== !disabled) editor.setEditable(!disabled, false)
  }, [editor, value, isStreaming, disabled])

  /**
   * Wires the `/Image` slash command to the hidden picker, but only for a host that gave us an
   * uploader — the command hides itself when this storage slot stays null, which is what keeps it
   * out of the modal field editors that have nowhere to put an image.
   */
  useEffect(() => {
    if (!editor || !uploadImage) return
    editor.storage.slashCommand.insertImage = (at: number) => {
      pendingImagePosRef.current = at
      imageInputRef.current?.click()
    }
    return () => {
      editor.storage.slashCommand.insertImage = null
    }
  }, [editor, uploadImage])

  useEditorMentions(editor, workspaceId, { disableTagging })

  return (
    <div
      ref={containerRef}
      className={cn(
        // `relative` makes this the positioning context for the bubble menu, which is
        // appended here and absolutely positioned so it tracks the selection through scroll.
        'relative flex flex-col',
        // Only a capped box scrolls itself. Uncapped, the box grows and the page
        // scrolls — making it a scroll container anyway would clip the bubble
        // menu against an edge that never moves.
        maxHeight !== undefined && 'overflow-y-auto',
        !isBare && [
          'px-3 py-2',
          chipFieldSurfaceClass,
          error && 'border-[var(--text-error)]',
          !disabled && !isStreaming && 'cursor-text',
          // Match the chip fields' disabled chrome (dimmed, not copyable) while
          // keeping the container scrollable; streaming stays full-strength.
          disabled && !isStreaming && 'select-none opacity-50',
        ],
        isBare && 'min-h-full w-full'
      )}
      style={{ minHeight: boxMinHeight, maxHeight }}
    >
      {editor && (
        <EditorBubbleMenu
          editor={editor}
          scrollContainerRef={isBare ? BODY_PORTAL : containerRef}
        />
      )}
      {editor && <LinkHoverCard editor={editor} />}
      {uploadImage && (
        <input
          ref={imageInputRef}
          type='file'
          accept='image/*'
          multiple
          hidden
          onChange={(event) => {
            const input = event.currentTarget
            const images = Array.from(input.files ?? []).filter((file) =>
              file.type.startsWith('image/')
            )
            const at =
              pendingImagePosRef.current ?? editorInstanceRef.current?.state.selection.from ?? 0
            pendingImagePosRef.current = null
            input.value = ''
            if (images.length > 0) void insertImages(images, { from: at, to: at })
          }}
        />
      )}
      <EditorContent
        editor={editor}
        className={cn(
          'flex flex-1 flex-col',
          isBare
            ? proseClassName
            : 'selection:bg-[var(--selection-bg)] selection:text-[var(--text-primary)] dark:selection:bg-[var(--selection-dark)] dark:selection:text-white'
        )}
      />
    </div>
  )
}

/**
 * Raw-text fallback for content the rich editor can't round-trip losslessly — editing the markdown
 * source directly so an edit can't silently drop footnotes, raw HTML, or comments. Honors the same
 * `onPasteText` hook as the WYSIWYG path (e.g. skill `SKILL.md` destructuring) so a full-document paste
 * is intercepted here too.
 */
function RawMarkdownField({
  value,
  onChange,
  placeholder,
  disabled = false,
  isStreaming = false,
  minHeight,
  maxHeight,
  error = false,
  onPasteText,
  surface = 'field',
  proseClassName,
}: RichMarkdownFieldProps) {
  // Disabled-look without the `disabled` attribute — a disabled textarea is
  // inert to wheel/scrollbar, but locked content must stay scrollable.
  const lockedView = disabled && !isStreaming
  const isBare = surface === 'bare'
  const boxMinHeight = minHeight ?? (isBare ? undefined : 140)

  /**
   * Uncapped, the textarea grows with its content so it matches the WYSIWYG
   * path on a full-page surface — a textarea has no intrinsic auto-height, so
   * the height is synced to `scrollHeight` on every value change. Capped (in a
   * modal) it keeps its own scrollbar and this is skipped.
   */
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const autoGrow = maxHeight === undefined
  useLayoutEffect(() => {
    if (!autoGrow) return
    const el = textareaRef.current
    if (!el) return

    const measure = () => {
      el.style.height = 'auto'
      el.style.height = `${Math.max(el.scrollHeight, boxMinHeight ?? 0)}px`
    }
    measure()

    // The box is `overflow-hidden` while uncapped, so a width change that
    // re-wraps lines without touching `value` would clip the tail with no
    // scrollbar to reach it — re-measure whenever the element resizes.
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [autoGrow, value, boxMinHeight])

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = event.clipboardData.getData('text/plain')
    if (!text) return
    if (onPasteText?.(text)) {
      event.preventDefault()
      return
    }

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

  /* A bare host paints its own surface, so the raw fallback is a plain
     textarea inheriting the host's colour — a chip field nested inside a Note
     card would draw a second, conflicting surface. */
  if (isBare) {
    return (
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onPaste={handlePaste}
        data-paste-max-bytes={PASTE_LIMITS.RICH_MARKDOWN_BYTES}
        placeholder={placeholder}
        readOnly={isStreaming || lockedView}
        tabIndex={lockedView ? -1 : undefined}
        className={cn(
          'w-full resize-none border-none bg-transparent p-0 text-current caret-current outline-hidden focus-visible:outline-hidden',
          'scrollbar-none placeholder:text-current placeholder:opacity-55',
          lockedView && 'select-none opacity-50',
          autoGrow && 'overflow-hidden',
          proseClassName
        )}
        style={{ minHeight: boxMinHeight, maxHeight }}
      />
    )
  }

  return (
    <ChipTextarea
      ref={textareaRef}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onPaste={handlePaste}
      data-paste-max-bytes={PASTE_LIMITS.RICH_MARKDOWN_BYTES}
      placeholder={placeholder}
      error={error}
      viewOnly={lockedView}
      readOnly={isStreaming}
      tabIndex={lockedView ? -1 : undefined}
      className={cn(lockedView && 'select-none opacity-50', autoGrow && 'overflow-hidden')}
      style={{ minHeight: boxMinHeight, maxHeight }}
    />
  )
}

/**
 * A controlled, string-valued markdown editor. Inside a modal, drop it in a `ChipModalField
 * type='custom'` and pass a `maxHeight` so it scrolls within the modal; on a full-page surface omit
 * `maxHeight` so it grows with its content and the page owns the only scrollbar.
 * Mirrors the file editor's safety gate (decided once from the initial value):
 * round-trip-safe content opens in the WYSIWYG editor, while lossy markdown (raw HTML, footnotes,
 * comments) falls back to raw-text editing so an edit can't silently drop those constructs.
 *
 * Blast radius, since this sits under the file editor's directory but is NOT the file editor:
 * `RichMarkdownEditor` (the workspace file editor) does not render this component at all. Changing
 * it reaches the canvas Note, the skill modal, skill fields, and the deploy version description —
 * and nothing else. The shared base both editors DO have in common is everything else in this
 * folder: the extension set, the markdown parse/serialize, the menus, and the stylesheet.
 */
export function RichMarkdownField(props: RichMarkdownFieldProps) {
  const [isSafe] = useState(() => isRoundTripSafe(props.value))
  return isSafe ? <LoadedRichMarkdownField {...props} /> : <RawMarkdownField {...props} />
}
