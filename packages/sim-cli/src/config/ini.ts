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

export function parseIni(text: string): IniDocument {
  const doc: IniDocument = { preamble: [], sections: [] }
  let current: Section | null = null

  for (const line of text.split('\n')) {
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

export function getSection(doc: IniDocument, name: string): Record<string, string> | null {
  const section = doc.sections.find((s) => s.name === name)
  if (!section) return null

  const values: Record<string, string> = {}
  for (const entry of section.entries) {
    if (entry.kind === 'kv') values[entry.key] = entry.value
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
 */
export function setSectionValues(
  doc: IniDocument,
  name: string,
  values: Record<string, string | null>
): void {
  let section = doc.sections.find((s) => s.name === name)
  if (!section) {
    section = { name, entries: [] }
    doc.sections.push(section)
  }

  for (const [key, value] of Object.entries(values)) {
    const index = section.entries.findIndex((e) => e.kind === 'kv' && e.key === key)

    if (value === null) {
      if (index !== -1) section.entries.splice(index, 1)
      continue
    }

    if (index === -1) {
      section.entries.push({ kind: 'kv', key, value })
    } else {
      section.entries[index] = { kind: 'kv', key, value }
    }
  }
}

export function removeSection(doc: IniDocument, name: string): boolean {
  const index = doc.sections.findIndex((s) => s.name === name)
  if (index === -1) return false
  doc.sections.splice(index, 1)
  return true
}
