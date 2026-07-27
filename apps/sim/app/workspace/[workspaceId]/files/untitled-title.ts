import { truncate } from '@sim/utils/string'

/**
 * The name a freshly-created markdown file is given in `handleCreateFile`: `untitled.md`, or
 * `untitled (n).md` when that is taken. A file keeps this "unnamed" status until it is renamed —
 * while unnamed, the file name and the document's leading heading are coupled (typing a heading
 * names the file; naming the file seeds a heading). See {@link isUntitledName}.
 */
export const DEFAULT_UNTITLED_NAME = 'untitled.md'

const UNTITLED_NAME_RE = /^untitled(?: \(\d+\))?\.md$/

/** Longest title kept when deriving a file name from a heading, before the `.md` extension. */
const MAX_DERIVED_TITLE_LENGTH = 100

/**
 * Filename characters disallowed across the common platforms (`\ / : * ? " < > |`) plus C0 control
 * characters, replaced with a space when deriving a file name from heading text.
 */
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\x00-\x1f]/g

/** True when `name` is still the auto-assigned untitled markdown name (`untitled.md`, `untitled (2).md`). */
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
 * Makes `name` unique among `existingNames` by appending ` (n)` before the `.md` extension — the same
 * scheme `handleCreateFile` uses for the default untitled name.
 */
export function uniqueMarkdownName(name: string, existingNames: ReadonlySet<string>): string {
  if (!existingNames.has(name)) return name
  const withoutExt = name.replace(/\.md$/i, '')
  let counter = 1
  let candidate = `${withoutExt} (${counter}).md`
  while (existingNames.has(candidate)) {
    counter++
    candidate = `${withoutExt} (${counter}).md`
  }
  return candidate
}
