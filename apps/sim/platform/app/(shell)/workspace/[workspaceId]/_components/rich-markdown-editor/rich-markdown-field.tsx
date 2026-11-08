'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formatPasteLimit, PASTE_LIMITS } from '@sim/utils/paste'
import type { JSONContent, Range } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { EditorBubbleMenu } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/rich-markdown-editor/bubble-menu'
import { createMarkdownEditorExtensions } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/rich-markdown-editor/editor-extensions'
import {
  beginImageUploads,
  findImageUpload,
  finishImageUpload,
  removeImageUpload,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/rich-markdown-editor/image-upload'
import { LinkHoverCard } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/rich-markdown-editor/link-hover-card'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/_components/rich-markdown-editor/rich-markdown-field.module.css'
import { TableBubbleMenu } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/rich-markdown-editor/table-menu'
import {
  applyFrontmatter,
  extractImageFiles,
  getImageFileFallback,
  type ImageFileFallback,
  isPlainTextPaste,
  moveDraggedImageNode,
  normalizeMarkdownContent,
  normalizePastedImageSources,
  parseMarkdownToDoc,
  postProcessSerializedMarkdown,
  resolveImageFileFallback,
  splitFrontmatter,
} from '@/platform/lib/data/files/markdown'
import { toast } from '@/platform/shared/toast'

function warnRichMarkdownPasteLimit() {
  toast.warning('Paste is too large for rich-text editing', {
    description: `Keep this document under ${formatPasteLimit(PASTE_LIMITS.RICH_MARKDOWN_BYTES)}, or import the content as a file.`,
  })
}

/** The Platform surface around an element: themed, and not clipped by a small host such as a card. */
function closestSurface(element: HTMLElement | null): HTMLDivElement | null {
  const surface = element?.closest('[data-platform-ui]')
  return surface instanceof HTMLDivElement ? surface : null
}

interface RichMarkdownFieldProps {
  /** The markdown the editor opens with. Seeds the editor once on mount. */
  value: string
  /** Fires with the serialized markdown on every local edit. */
  onChange: (markdown: string) => void
  placeholder: string
  /** Read-only while false, such as while a save holds the value. */
  editable?: boolean
  /**
   * A viewport point to place the caret at on mount instead of the document end, for a host whose
   * read view sits under a click-to-edit overlay that consumed the opening click.
   */
  autoFocusAt?: { clientX: number; clientY: number } | null
  /**
   * Uploads a pasted, dropped or `/Image`-picked image and returns its hosted URL, or null on failure.
   * Without it, file drops are swallowed so the browser cannot navigate to the file, and `/Image`
   * hides itself.
   */
  uploadImage?: (file: File) => Promise<{ url: string; alt: string } | null>
  /**
   * Where the formatting and table bars open. `field` keeps them inside the field so they scroll with
   * it; `surface` lifts them to the enclosing Platform surface, for a small host that clips its own
   * overflow, such as the canvas Note card.
   */
  menuLayer?: 'field' | 'surface'
}

/**
 * A rich markdown field without a file behind it: the file editor's schema, parser, serializer,
 * paste handling and image upload anchors, with its `/` command menu, formatting bar (links
 * included), table bar, link hover card, resizable images and code-block language picker. It draws
 * no frame and sets no type ramp: the host owns its surface, type and ink, and scopes them to the
 * field from its own wrapper. Content that cannot round-trip losslessly (`isRoundTripSafe`) belongs
 * in the host's raw-source fallback instead.
 */
export function RichMarkdownField({
  value,
  onChange,
  placeholder,
  editable = true,
  autoFocusAt = null,
  uploadImage,
  menuLayer = 'field',
}: RichMarkdownFieldProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const menuLayerRef = useRef<HTMLDivElement | null>(null)
  /** Frontmatter is held out-of-band and re-attached on serialize, exactly like the file editor. */
  const [initialSplit] = useState(() => splitFrontmatter(value))
  const frontmatterRef = useRef(initialSplit.frontmatter)
  /** The body last reflected into the editor, updated on local edits. */
  const lastSyncedBodyRef = useRef(initialSplit.body)
  const onChangeRef = useRef(onChange)
  const uploadImageRef = useRef(uploadImage)
  const autoFocusAtRef = useRef(autoFocusAt)
  const editorInstanceRef = useRef<ReturnType<typeof useEditor>>(null)
  /** The `/Image` command opens this picker; the caret position it ran at is where images land. */
  const imageInputRef = useRef<HTMLInputElement>(null)
  const pendingImagePosRef = useRef<number | null>(null)

  /** Each upload lands at its own mapped anchor, so a multi-image drop keeps its order. */
  async function insertImages(images: File[], range: Range, fallback?: ImageFileFallback | null) {
    const upload = uploadImageRef.current
    const owner = editorInstanceRef.current
    if (!upload || !owner || owner.isDestroyed || !owner.isEditable) return
    const anchors = beginImageUploads(
      owner,
      range,
      images.map(() => '')
    )
    const canInsert = () =>
      editorInstanceRef.current === owner && !owner.isDestroyed && owner.isEditable
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
   * The original value verbatim, plus its canonical serialization. The editor only emits canonical
   * markdown, so reporting the original while the document still matches its canonical form keeps a
   * non-canonical input from reading as an edit on mount.
   */
  const initialValueRef = useRef(value)
  const [canonicalSeed] = useState(() => normalizeMarkdownContent(value))

  /** TipTap extensions are stateful: one set per mount, so each field keeps its own placeholder. */
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
    editable,
    enablePasteRules: false,
    autofocus: autoFocusAt ? false : 'end',
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    content: initialContent,
    editorProps: {
      attributes: {
        class: styles.editor,
        role: 'textbox',
        'aria-multiline': 'true',
        // Claim ⌘K so the formatting bar's link editor wins over the global search palette.
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
        return false
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
    /* Resolved after creation, not via `autofocus`: mapping a point needs the editor laid out. */
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
    uploadImageRef.current = uploadImage
  }, [onChange, uploadImage])

  /** React can unmount the field before TipTap's deferred destruction runs. */
  useLayoutEffect(() => {
    editorInstanceRef.current = editor
    return () => {
      editorInstanceRef.current = null
    }
  }, [editor])

  useLayoutEffect(() => {
    menuLayerRef.current =
      menuLayer === 'surface' ? closestSurface(containerRef.current) : containerRef.current
  }, [menuLayer])

  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable, false)
  }, [editor, editable])

  /** `/Image` opens the picker only for a host that can store the image; otherwise it hides. */
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

  return (
    <div ref={containerRef} className={styles.field}>
      {editor && <EditorBubbleMenu editor={editor} scrollContainerRef={menuLayerRef} />}
      {editor && <TableBubbleMenu editor={editor} scrollContainerRef={menuLayerRef} />}
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
      <div className={styles.content}>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
