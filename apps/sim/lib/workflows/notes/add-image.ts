/**
 * "Add image" travels from the canvas context menu to the Note card that owns
 * the content, which are far apart in the tree and share no store — the same
 * shape the canvas already uses for `remove-from-subflow`.
 *
 * The Note is the only place that can act on it: the image is appended to that
 * block's markdown, so the upload and the write belong next to the content, not
 * next to the menu.
 */
export const NOTE_ADD_IMAGE_EVENT = 'add-note-image'

export interface NoteAddImageDetail {
  blockId: string
}

/** Asks the Note card with this id to prompt for an image and append it. */
export function requestNoteImage(blockId: string): void {
  window.dispatchEvent(
    new CustomEvent<NoteAddImageDetail>(NOTE_ADD_IMAGE_EVENT, { detail: { blockId } })
  )
}

/**
 * Appends an image to a note's markdown as its own block.
 *
 * The blank line is what makes it a block rather than part of the preceding
 * paragraph, and trimming the tail first keeps a note that already ends in blank
 * lines from growing a run of them with every image.
 */
export function appendNoteImageMarkdown(
  content: string,
  image: { url: string; alt: string }
): string {
  const body = content.trimEnd()
  return `${body ? `${body}\n\n` : ''}![${image.alt}](${image.url})`
}
