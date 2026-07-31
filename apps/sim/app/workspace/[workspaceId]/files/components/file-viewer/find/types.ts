/**
 * Fixed search configuration. There are no UI toggles — find is case-insensitive literal, matching the
 * Tables module's find. The flags are kept so every per-surface matcher shares one `search` signature.
 */
export interface FindFlags {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

/** The single find configuration the provider uses everywhere: case-insensitive literal substring. */
export const DEFAULT_FIND_FLAGS: FindFlags = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
}

/** Snapshot a controller reports back to the provider after a search or a step. */
export interface FindResult {
  /** Total matches in the surface. */
  count: number
  /** 0-based index of the active match, or -1 when there are none. */
  currentIndex: number
  /** True when the surface only searched a capped/loaded window (e.g. a truncated table preview). */
  truncated: boolean
}

export const EMPTY_FIND_RESULT: FindResult = {
  count: 0,
  currentIndex: -1,
  truncated: false,
}

/**
 * Imperative contract every searchable file-viewer surface (Monaco, the markdown editor, a read-only
 * DOM preview) implements. Find-only — no replace. The {@link FileFindProvider} owns the bar and drives
 * the active surface through this interface; the surface reports match counts through its reporter.
 */
export interface FindController {
  /** Higher wins when several surfaces are mounted at once (a split editor + preview): editor > preview. */
  priority: number
  /** Run the search for `query`; reports the result. */
  search: (query: string, flags: FindFlags) => void
  /** Move to the next match, wrapping past the end. */
  next: () => void
  /** Move to the previous match, wrapping past the start. */
  prev: () => void
  /** Return focus to the underlying surface (used when the bar closes). */
  focusTarget: () => void
  /** Clear highlights and any transient state. */
  dispose: () => void
}

export type FindResultReporter = (result: FindResult) => void

/** Priority tiers for {@link FindController.priority}. Editable editors outrank read-only previews. */
export const FIND_PRIORITY = {
  editor: 2,
  readOnly: 1,
} as const
