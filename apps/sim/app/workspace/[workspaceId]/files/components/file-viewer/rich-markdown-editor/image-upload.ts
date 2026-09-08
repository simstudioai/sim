import { generateShortId } from '@sim/utils/id'
import { type Editor, Extension, type Range } from '@tiptap/core'
import type { Slice } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { imageTypeAt } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-node'

interface PendingImageUpload extends Range {
  id: string
  batchId: string
  label: string
  replacement: Slice | null
  side: -1 | 1
}

interface ImageUploadState {
  uploads: ReadonlyMap<string, PendingImageUpload>
  decorations: DecorationSet
}

interface UploadPlaceholderAction {
  add?: PendingImageUpload[]
  remove?: string
  complete?: string
}

const uploadPlaceholderKey = new PluginKey<ImageUploadState>('imageUploadPlaceholders')

function uploadDecoration({ id, from, label, side }: PendingImageUpload): Decoration {
  return Decoration.widget(
    from,
    (view) => {
      const placeholder = document.createElement('span')
      placeholder.contentEditable = 'false'
      if (label) {
        placeholder.className =
          'mx-1 rounded border border-[var(--border)] px-2 py-1 text-[var(--text-muted)] text-small'
        placeholder.setAttribute('role', 'status')
        placeholder.textContent = `Uploading ${label}…`
        const cancel = document.createElement('button')
        cancel.type = 'button'
        cancel.className =
          'ml-2 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--selection)]'
        cancel.textContent = 'Cancel insertion'
        cancel.setAttribute('aria-label', `Cancel insertion of ${label}`)
        cancel.title = 'The file may still finish uploading to the workspace.'
        cancel.addEventListener('mousedown', (event) => event.preventDefault())
        cancel.addEventListener('click', () => {
          const restoreFocus = document.activeElement === cancel
          view.dispatch(view.state.tr.setMeta(uploadPlaceholderKey, { remove: id }))
          if (restoreFocus) view.focus()
        })
        placeholder.append(cancel)
      }
      return placeholder
    },
    { id, key: id, side, stopEvent: () => true }
  )
}

/** Local-only upload anchors follow document transactions without persisting temporary URLs. */
export const ImageUploadPlaceholders = Extension.create({
  name: 'imageUploadPlaceholders',
  addProseMirrorPlugins() {
    return [
      new Plugin<ImageUploadState>({
        key: uploadPlaceholderKey,
        state: {
          init: () => ({ uploads: new Map(), decorations: DecorationSet.empty }),
          apply(transaction, previous) {
            const action = transaction.getMeta(uploadPlaceholderKey) as
              | UploadPlaceholderAction
              | undefined
            const completed = action?.complete ? previous.uploads.get(action.complete) : undefined
            const uploads = new Map<string, PendingImageUpload>()
            for (const [id, upload] of previous.uploads) {
              if (id === action?.remove || id === action?.complete) continue
              if (completed?.batchId === upload.batchId) {
                const position = transaction.mapping.map(upload.to, 1)
                /** Queued siblings stay before trailing paragraphs appended after this image. */
                uploads.set(id, {
                  ...upload,
                  from: position,
                  to: position,
                  replacement: null,
                  side: -1,
                })
                continue
              }
              const from = transaction.mapping.mapResult(upload.from, upload.side)
              const to = upload.replacement ? transaction.mapping.mapResult(upload.to, -1) : from
              if (from.deleted || to.deleted) continue
              if (
                upload.replacement &&
                (from.pos >= to.pos ||
                  !transaction.doc.slice(from.pos, to.pos).eq(upload.replacement))
              )
                continue
              uploads.set(id, { ...upload, from: from.pos, to: to.pos })
            }
            for (const upload of action?.add ?? []) uploads.set(upload.id, upload)
            return {
              uploads,
              decorations: DecorationSet.create(
                transaction.doc,
                Array.from(uploads.values(), uploadDecoration)
              ),
            }
          },
        },
        props: { decorations: (state) => uploadPlaceholderKey.getState(state)?.decorations },
      }),
    ]
  },
})

/**
 * Anchor queued uploads without changing selected content before success.
 * Cancel replacement when a transaction deletes or changes the captured range.
 */
export function beginImageUploads(editor: Editor, range: Range, labels: string[]): string[] {
  if (editor.isDestroyed || !editor.isEditable || labels.length === 0) return []
  const transaction = editor.state.tr
  const batchId = generateShortId()
  const replacement = range.from === range.to ? null : transaction.doc.slice(range.from, range.to)
  const placeholders = labels.map((label) => ({
    id: generateShortId(),
    batchId,
    from: range.from,
    to: range.to,
    label,
    replacement,
    side: 1 as const,
  }))
  transaction.setMeta(uploadPlaceholderKey, { add: placeholders } satisfies UploadPlaceholderAction)
  editor.view.dispatch(transaction)
  return placeholders.map(({ id }) => id)
}

export function findImageUpload(editor: Editor, id: string): number | null {
  return findImageUploadRange(editor, id)?.from ?? null
}

/** Reads the current replacement range without exposing the plugin's pending state. */
export function findImageUploadRange(editor: Editor, id: string): Range | null {
  if (editor.isDestroyed) return null
  const upload = uploadPlaceholderKey.getState(editor.state)?.uploads.get(id)
  return upload ? { from: upload.from, to: upload.to } : null
}

export function removeImageUpload(editor: Editor, id: string): void {
  if (editor.isDestroyed) return
  editor.view.dispatch(
    editor.state.tr.setMeta(uploadPlaceholderKey, { remove: id } satisfies UploadPlaceholderAction)
  )
}

/**
 * Commit one image at its surviving range. The first successful image replaces the captured content;
 * its queued siblings become insertion anchors after it. Cancellation and failure never delete text.
 */
export function finishImageUpload(editor: Editor, id: string, src: string, alt: string): boolean {
  if (editor.isDestroyed) return false
  const upload = uploadPlaceholderKey.getState(editor.state)?.uploads.get(id)
  if (!upload) return false
  if (!editor.isEditable) {
    removeImageUpload(editor, id)
    return false
  }
  const inserted = editor
    .chain()
    .insertContentAt(
      { from: upload.from, to: upload.to },
      { type: imageTypeAt(editor.state.doc, upload.from), attrs: { src, alt } },
      { updateSelection: false }
    )
    .command(({ tr }) => {
      tr.setMeta(uploadPlaceholderKey, { complete: id } satisfies UploadPlaceholderAction)
      return true
    })
    .run()
  if (!inserted) removeImageUpload(editor, id)
  return inserted
}
