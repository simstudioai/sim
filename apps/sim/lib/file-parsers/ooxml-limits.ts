/**
 * Shared size ceilings for OOXML (docx/xlsx/pptx) archives, applied both by the
 * server-side parse guard ({@link ./zip-guard}) and the browser preview guard
 * ({@link ./ooxml-preview-guard}). The downstream parsers build a full in-memory
 * DOM/object graph many times the XML size, so a small archive that expands past
 * these bounds can exhaust the shared server process or the viewer's browser tab.
 *
 * This module is dependency-free and browser-safe on purpose, so both the Node
 * guard and the client previews resolve the same numbers from one source.
 */

/** Hard ceiling on the summed declared uncompressed size of all entries. */
export const MAX_OOXML_TOTAL_UNCOMPRESSED_BYTES = 150 * 1024 * 1024

/** Hard ceiling on any single entry's declared uncompressed size. */
export const MAX_OOXML_ENTRY_UNCOMPRESSED_BYTES = 64 * 1024 * 1024

export class ZipBombError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipBombError'
  }
}
