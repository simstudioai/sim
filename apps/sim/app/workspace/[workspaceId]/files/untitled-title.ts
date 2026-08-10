import { truncate } from '@sim/utils/string'

/**
 * The name a freshly-created markdown file is given in `handleCreateFile`: `untitled.md`, or
 * `untitled (n).md` when that is taken. A file keeps this "unnamed" status until it is renamed —
 * while unnamed, typing a leading heading names the file (one direction only; the reverse
 * name→heading seed was removed as unsafe on the shared editor). See {@link isUntitledName}.
 */
export const DEFAULT_UNTITLED_NAME = 'untitled.md'

/**
 * Any extension, not just `.md`: a file created as `untitled.md` and immediately retyped to JSON is
 * still an unnamed file, and should keep naming itself from its first heading if it is retyped back.
 * A bare `untitled` with no extension is a name the user chose, so it does not match. Still
 * case-sensitive: only the lowercase name this app generates counts as unnamed, so a file a user
 * deliberately called `Untitled.md` is left alone.
 */
const UNTITLED_NAME_RE = /^untitled(?: \(\d+\))?\.[a-z0-9]+$/

/** Longest title kept when deriving a file name from a heading, before the `.md` extension. */
const MAX_DERIVED_TITLE_LENGTH = 100

/**
 * Filename characters disallowed across the common platforms (`\ / : * ? " < > |`) plus C0 control
 * characters, replaced with a space when deriving a file name from heading text.
 */
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\x00-\x1f]/g

/** True when `name` is still the auto-assigned untitled name (`untitled.md`, `untitled (2).json`). */
export function isUntitledName(name: string): boolean {
  return UNTITLED_NAME_RE.test(name)
}

/**
 * Derives a markdown file name from heading text — illegal filename characters dropped, whitespace
 * collapsed, trimmed, hard-capped at {@link MAX_DERIVED_TITLE_LENGTH}, and suffixed with `.md`.
 * Returns null when nothing usable remains (e.g. a heading of only slashes), so the caller keeps the
 * current name.
 */
export function deriveMarkdownFileName(headingText: string): string | null {
  const base = headingText.replace(ILLEGAL_FILENAME_CHARS, ' ').replace(/\s+/g, ' ').trim()
  if (!base) return null
  // Re-trim after the hard cap: truncation can land mid-word and leave a trailing space (`"foo .md"`).
  const capped = truncate(base, MAX_DERIVED_TITLE_LENGTH, '').trim()
  if (!capped) return null
  // A heading that already ends in `.md` (e.g. `# README.md`) must not become `README.md.md`.
  return /\.md$/i.test(capped) ? capped : `${capped}.md`
}

/**
 * Makes `name` unique among `existingNames` by inserting ` (n)` before the extension — the same
 * scheme `handleCreateFile` uses for the default untitled name, and the same last-dot rule the
 * server's `withCopySuffix` applies, so `report.final.csv` becomes `report.final (2).csv`. A name
 * with no extension takes the suffix at the end: `notes` becomes `notes (2)`.
 */
export function uniqueFileName(name: string, existingNames: ReadonlySet<string>): string {
  if (!existingNames.has(name)) return name
  const lastDot = name.lastIndexOf('.')
  const hasExtension = lastDot > 0 && lastDot < name.length - 1
  const base = hasExtension ? name.slice(0, lastDot) : name
  const extension = hasExtension ? name.slice(lastDot) : ''
  let counter = 1
  let candidate = `${base} (${counter})${extension}`
  while (existingNames.has(candidate)) {
    counter++
    candidate = `${base} (${counter})${extension}`
  }
  return candidate
}
