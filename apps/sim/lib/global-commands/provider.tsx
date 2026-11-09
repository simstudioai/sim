'use client'

export interface GlobalCommand {
  id?: string
  /** Keyboard binding. Omit for palette-only commands invoked by id. */
  shortcut?: string
  allowInEditable?: boolean
  handler: (event: KeyboardEvent) => void
}
