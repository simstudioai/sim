/**
 * Actions the canvas context menu asks a Note card to perform on itself.
 *
 * A Note owns its own editing surface — the panel editor renders nothing for
 * one — so the menu cannot act on a note the way it acts on every other block.
 * The menu and the card are also far apart in the tree and share no store, the
 * same shape the canvas already uses for `remove-from-subflow`.
 */

export const NOTE_ADD_IMAGE_EVENT = 'add-note-image'
export const NOTE_RENAME_EVENT = 'rename-note'

export interface NoteBlockRequestDetail {
  blockId: string
}

function requestFromNote(eventName: string, blockId: string): void {
  window.dispatchEvent(new CustomEvent<NoteBlockRequestDetail>(eventName, { detail: { blockId } }))
}

/** Asks the Note card with this id to prompt for an image and append it. */
export function requestNoteImage(blockId: string): void {
  requestFromNote(NOTE_ADD_IMAGE_EVENT, blockId)
}

/**
 * Asks the Note card with this id to open its own title for editing.
 *
 * The panel editor's rename is unreachable for a note: it clears any note put
 * in front of it and renders nothing, so a rename started there would latch
 * onto a block the panel never shows.
 */
export function requestNoteRename(blockId: string): void {
  requestFromNote(NOTE_RENAME_EVENT, blockId)
}
