/**
 * Skills: `skills/<key>.md` is a frontmatter block of exactly `name` and `description`, then the
 * skill's content, byte for byte.
 *
 * ```md
 * ---
 * name: tone
 * description: "Answer in the support team's voice: short, warm, specific."
 * ---
 * Write like a person, not a policy.
 * ```
 *
 * A frontmatter value is plain text on one line, or a JSON string (`"…"`, also valid YAML) when
 * plain text could not hold it exactly: a value with a line break, surrounding spaces, quotes or
 * YAML syntax characters. The server checks names and lengths against the skill rules.
 */
import { unstorableCharacter } from '../declaration/read'
import { diagnostic, located, spanAt, type WorkspaceDiagnostic } from '../diagnostics'
import { KIND_DIRS, type KindCodec } from '../kind'
import { groupByFile } from './group'

export interface SkillDecl {
  name: string
  description: string
  content: string
}

const EXTENSION = '.md'
const FENCE = '---'
const FIELDS = ['name', 'description'] as const

type SkillField = (typeof FIELDS)[number]

/** `skills/<key>.md`. */
export function skillPath(key: string): string {
  return `${KIND_DIRS.skill}/${key}${EXTENSION}`
}

/**
 * A value that reads back as itself when printed bare: one line, no surrounding spaces, and
 * nothing YAML would read as syntax (a leading indicator, `: `, ` #`, a trailing `:`).
 */
function isPlain(value: string): boolean {
  return (
    /^[A-Za-z0-9(][^\n\r"]*$/.test(value) &&
    value.trim() === value &&
    !value.includes(': ') &&
    !value.includes(' #') &&
    !value.endsWith(':')
  )
}

/** A plain value YAML would read as a boolean, null or number rather than text. */
const YAML_SCALAR = /^(?:true|false|yes|no|on|off|null|~|[-+]?[0-9][0-9._]*)$/i

function printValue(value: string): string {
  return isPlain(value) && !YAML_SCALAR.test(value) ? value : JSON.stringify(value)
}

function isField(name: string): name is SkillField {
  return (FIELDS as readonly string[]).includes(name)
}

function parseSkill(
  key: string,
  text: Readonly<Record<string, string>>
): { decl?: SkillDecl; diagnostics: WorkspaceDiagnostic[] } {
  const file = skillPath(key)
  const source = text[file] ?? ''
  const diagnostics: WorkspaceDiagnostic[] = []
  const report = (start: number, end: number, message: string) => {
    diagnostics.push(
      diagnostic('E_SKILL_FRONTMATTER', message, {
        kind: 'skill',
        key,
        ...located(source, spanAt(file, source, start, end)),
        hint: `A skill file opens with a \`${FENCE}\` line, \`name: …\`, \`description: …\` and a \`${FENCE}\` line; its content follows.`,
      })
    )
  }
  const open = `${FENCE}\n`
  if (!source.startsWith(open)) {
    report(
      0,
      Math.min(source.length, FENCE.length),
      `The file must start with a \`${FENCE}\` line.`
    )
    return { diagnostics }
  }
  let close = source.indexOf(`\n${FENCE}\n`, FENCE.length)
  if (close === -1 && source.endsWith(`\n${FENCE}`)) close = source.length - FENCE.length - 1
  if (close === -1) {
    report(0, FENCE.length, `The frontmatter has no closing \`${FENCE}\` line.`)
    return { diagnostics }
  }
  const values: Partial<Record<SkillField, string>> = {}
  const attempted = new Set<string>()
  let offset = open.length
  for (const line of close < offset ? [] : source.slice(offset, close).split('\n')) {
    const at = offset
    offset += line.length + 1
    const colon = line.indexOf(':')
    const field = colon === -1 ? '' : line.slice(0, colon)
    if (!isField(field) || line[colon + 1] !== ' ') {
      report(
        at,
        at + line.length,
        isField(field) || colon === -1
          ? 'Each frontmatter line is `field: value`.'
          : `Unknown frontmatter field "${field}"; a skill has only name and description.`
      )
      continue
    }
    if (attempted.has(field)) {
      report(at, at + line.length, `"${field}" is declared twice.`)
      continue
    }
    attempted.add(field)
    const raw = line.slice(colon + 2)
    const value = raw.startsWith('"') ? readQuoted(raw) : isPlain(raw) ? raw : null
    if (value === null) {
      report(
        at,
        at + line.length,
        raw.startsWith('"')
          ? `The ${field} is not a valid quoted string.`
          : `Quote the ${field} ("…"): it is empty or holds characters plain text cannot.`
      )
      continue
    }
    const problem = unstorableCharacter(value)
    if (problem)
      report(at, at + line.length, `The ${field} holds ${problem}, which cannot be stored.`)
    else values[field] = value
  }
  for (const field of FIELDS) {
    if (!attempted.has(field)) report(0, FENCE.length, `The frontmatter has no ${field}.`)
  }
  const content = source.slice(Math.min(source.length, close + FENCE.length + 2))
  const problem = unstorableCharacter(content)
  if (problem)
    report(
      close + 1,
      close + 1 + FENCE.length,
      `The content holds ${problem}, which cannot be stored.`
    )
  if (diagnostics.length > 0 || values.name === undefined || values.description === undefined) {
    return { diagnostics }
  }
  return { decl: { name: values.name, description: values.description, content }, diagnostics }
}

/** A JSON string value, or `null` when `raw` is not exactly one. */
function readQuoted(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'string' ? parsed : null
  } catch {
    return null
  }
}

export const skillCodec: KindCodec<SkillDecl> = {
  kind: 'skill',
  dir: KIND_DIRS.skill,
  group: (paths) => groupByFile(KIND_DIRS.skill, EXTENSION, paths),
  parse: (key, text) => parseSkill(key, text),
  print: (key, decl) => ({
    text: {
      [skillPath(key)]: [
        FENCE,
        `name: ${printValue(decl.name)}`,
        `description: ${printValue(decl.description)}`,
        FENCE,
        decl.content,
      ].join('\n'),
    },
    blobs: [],
  }),
  canonical: (decl) => ({ name: decl.name, description: decl.description, content: decl.content }),
}
