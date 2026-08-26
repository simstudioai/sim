/**
 * A minimal INI reader/writer for the AWS-style `~/.sim/config` and
 * `~/.sim/credentials` files.
 *
 * Parsing keeps every line it did not understand — comments, blank lines,
 * unrecognized keys — and writing re-emits them in place. These are files people
 * hand-edit, so a round trip through `sim login` must not silently delete the
 * comment above someone's staging endpoint.
 *
 * Deliberately not a general INI implementation: no nested sections, no `[a.b]`
 * paths, no quoting rules beyond trimming. The format only has to carry a
 * handful of flat string settings.
 */

/**
 * An invalid stored setting, or a value the config files cannot represent.
 *
 * Defined here rather than in `profile.ts` because the writer below is the
 * lowest layer that rejects input, and `profile.ts` already imports this module.
 * `profile.ts` re-exports it, so callers keep seeing one error type — the one
 * the entrypoint renders as a message instead of a stack trace.
 */
export class ProfileConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProfileConfigError'
  }
}

type Entry = { kind: 'kv'; key: string; value: string } | { kind: 'raw'; text: string }

interface Section {
  name: string
  entries: Entry[]
}

export interface IniDocument {
  /** Lines before the first section header. */
  preamble: string[]
  sections: Section[]
}

const SECTION_PATTERN = /^\s*\[([^\]]*)\]\s*$/
const KV_PATTERN = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(.*?)\s*$/

/**
 * Characters a stored value may not contain.
 *
 * The format has no escape syntax (see the module note), so text that can end a
 * line is structure, not data: a value carrying a line break was written
 * verbatim and read back on the next load as a *second* setting in the same
 * section. That is the class of bug this closes — untrusted text reaching the
 * serializer could add settings nobody typed.
 *
 * The set is every C0 and C1 control character plus U+2028 and U+2029, the two
 * Unicode line separators. The separators matter for a second reason: they are
 * not line breaks to the reader below, so {@link KV_PATTERN} (whose `.` never
 * matches them) fails and the line is kept as opaque `raw` text — the key
 * silently vanishes on the next read although the write reported success, and
 * because the dead line no longer matches the key, the write after that appends
 * a duplicate.
 *
 * Exported because callers that refuse untrusted text *before* writing — so they
 * can say which side produced it — have to refuse exactly this set. A second
 * hand-kept copy drifted from this one once already, and the gap let a rejected
 * write land after an accepted one.
 */
export const FORBIDDEN_IN_VALUE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/

/** As {@link FORBIDDEN_IN_VALUE}, plus the brackets that would close or open a header. */
const FORBIDDEN_IN_NAME = /[\u0000-\u001f\u007f-\u009f\u2028\u2029[\]]/

/** Keys have to round-trip through the reader's own key pattern. */
const WRITABLE_KEY = /^[A-Za-z0-9_.-]+$/

/**
 * Refuses text that would not survive a write-then-read cycle as the same value.
 *
 * Rejecting rather than escaping is deliberate: the format has no escape
 * syntax, these files are hand-edited and read by AWS-style tooling that would
 * not decode one, and no legitimate profile name, workspace id, endpoint, or
 * API key contains a line break or a bracket. Inventing an escape here would
 * make the files unreadable to everything else that opens them.
 */
function assertWritable(text: string, what: string, forbidden: RegExp): void {
  if (forbidden.test(text)) {
    throw new ProfileConfigError(
      `Refusing to write ${what}: line breaks and control characters cannot be stored in the ~/.sim files, because the format has no way to escape them.`
    )
  }
  // The reader trims both section names and values, so padded text comes back
  // as something else: the read reports the setting missing although the write
  // reported success, and the next write appends a second block or key instead
  // of updating the one already there.
  if (text !== text.trim()) {
    throw new ProfileConfigError(
      `Refusing to write ${what}: leading or trailing whitespace is not preserved by the ~/.sim files, so it would not read back as written.`
    )
  }
}

export function parseIni(text: string): IniDocument {
  const doc: IniDocument = { preamble: [], sections: [] }
  let current: Section | null = null

  const lines = text.split('\n')
  // The file's terminating newline splits into a trailing empty element. Kept,
  // it became a blank `raw` entry owned by the last section, and
  // `setSectionValues` appended every later key after it — so each successive
  // write opened another gap between that section's keys.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()

  for (const line of lines) {
    const sectionMatch = SECTION_PATTERN.exec(line)
    if (sectionMatch) {
      current = { name: sectionMatch[1].trim(), entries: [] }
      doc.sections.push(current)
      continue
    }

    if (!current) {
      doc.preamble.push(line)
      continue
    }

    const kvMatch = KV_PATTERN.exec(line)
    // A `#`/`;` comment can contain `=`, so the comment check must come first.
    if (kvMatch && !/^\s*[#;]/.test(line)) {
      current.entries.push({ kind: 'kv', key: kvMatch[1], value: kvMatch[2] })
    } else {
      current.entries.push({ kind: 'raw', text: line })
    }
  }

  return doc
}

export function serializeIni(doc: IniDocument): string {
  const lines: string[] = [...doc.preamble]

  for (const section of doc.sections) {
    // Keep exactly one blank line between sections without accumulating them
    // across repeated writes.
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
    if (lines.length > 0) lines.push('')
    lines.push(`[${section.name}]`)
    for (const entry of section.entries) {
      lines.push(entry.kind === 'kv' ? `${entry.key} = ${entry.value}` : entry.text)
    }
  }

  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}

/**
 * Reads a section's keys, merging every block that repeats its name.
 *
 * A hand-edited file can carry two `[default]` blocks; reading only the first
 * silently dropped the second's keys and reported them as unset. The merge is
 * **first wins** per key, matching {@link setSectionValues}, which upserts into
 * the first block — so a value written through this module is the one read back.
 */
export function getSection(doc: IniDocument, name: string): Record<string, string> | null {
  const sections = doc.sections.filter((s) => s.name === name)
  if (sections.length === 0) return null

  const values: Record<string, string> = {}
  for (const section of sections) {
    for (const entry of section.entries) {
      if (entry.kind === 'kv' && !Object.hasOwn(values, entry.key)) values[entry.key] = entry.value
    }
  }
  return values
}

export function listSections(doc: IniDocument): string[] {
  return doc.sections.map((s) => s.name)
}

/**
 * Upserts values into a section, creating it when absent. A `null` value removes
 * the key. Existing keys are updated where they sit so surrounding comments keep
 * describing the line they were written above.
 *
 * A write targets the first block of that name, matching the first-wins read in
 * {@link getSection}. A removal instead has to clear every block and every
 * repeat of the key within one: deleting only the first left a later duplicate
 * to win the merged read, so `--unset` reported success while the value stayed
 * in force. A removal against a section that is not there writes nothing at all.
 *
 * This is the one place untrusted text enters the document, so it is where the
 * write is refused: see {@link FORBIDDEN_IN_VALUE} for what cannot be stored
 * and why the answer is a refusal rather than an escape.
 */
export function setSectionValues(
  doc: IniDocument,
  name: string,
  values: Record<string, string | null>
): void {
  // Everything is checked before anything is written, so a rejected write
  // leaves the document exactly as it was rather than half-applied.
  assertWritable(name, `a section named "${name}"`, FORBIDDEN_IN_NAME)
  for (const [key, value] of Object.entries(values)) {
    if (!WRITABLE_KEY.test(key)) {
      throw new ProfileConfigError(`Refusing to write an unreadable setting name "${key}".`)
    }
    if (value === null) continue
    // A value that is only whitespace reads back as the empty string, so the
    // key would look stored and resolve as unset. Checked before the general
    // rule below so it keeps its own, more specific message.
    if (value.trim() === '') {
      throw new ProfileConfigError(`Refusing to write a blank value for "${key}".`)
    }
    assertWritable(value, `a value for "${key}"`, FORBIDDEN_IN_VALUE)
  }

  const matching = doc.sections.filter((s) => s.name === name)
  let section = matching[0]
  if (!section) {
    // A removal has nothing to create the section for, and an empty section is
    // not inert: `listProfiles` counts section names, so conjuring one made an
    // unknown profile permanently pass the "does this profile exist?" check.
    if (Object.values(values).every((value) => value === null)) return
    section = { name, entries: [] }
    doc.sections.push(section)
    matching.push(section)
  }

  for (const [key, value] of Object.entries(values)) {
    if (value === null) {
      for (const target of matching) {
        target.entries = target.entries.filter((e) => !(e.kind === 'kv' && e.key === key))
      }
      continue
    }

    const index = section.entries.findIndex((e) => e.kind === 'kv' && e.key === key)
    if (index === -1) {
      section.entries.push({ kind: 'kv', key, value })
    } else {
      section.entries[index] = { kind: 'kv', key, value }
    }
  }
}

/**
 * Drops every block carrying the name, and reports whether one was there.
 *
 * A hand-edited file can repeat a section, and {@link getSection} merges them
 * all — so removing only the first left `sim logout` reporting a profile gone
 * while its later block still answered every read.
 */
export function removeSection(doc: IniDocument, name: string): boolean {
  const remaining = doc.sections.filter((s) => s.name !== name)
  if (remaining.length === doc.sections.length) return false
  doc.sections = remaining
  return true
}
