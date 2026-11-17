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
 * plain text could not hold it exactly: a value with a line break, surrounding spaces, quotes,
 * `: ` or ` #`, one ending in `:`, or one starting with anything but a letter, digit or `(`. The
 * printer also quotes a value a YAML reader would take for a boolean, null, number or date. The
 * server checks names and lengths against the skill rules.
 */
import { isOneOf } from '../declaration/fields'
import { unstorableCharacter } from '../declaration/read'
import { diagnostic, sourceLocator, type WorkspaceDiagnostic } from '../diagnostics'
import { KIND_DIRS, type KindCodec } from '../kind'
import { groupByFile } from './group'

/** A skill as `skills/<key>.md` declares it. */
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

/**
 * A plain value a YAML reader may take for something other than text: a YAML 1.1 or 1.2 boolean or
 * null, or anything starting with a digit (numbers in every base, dates, times, `1_000`).
 */
const YAML_SCALAR = /^(?:true|false|yes|no|y|n|on|off|null|~|[0-9].*)$/i

function printValue(value: string): string {
  return isPlain(value) && !YAML_SCALAR.test(value) ? value : JSON.stringify(value)
}

function parseSkill(
  key: string,
  text: Readonly<Record<string, string>>
): { decl?: SkillDecl; diagnostics: WorkspaceDiagnostic[] } {
  const file = skillPath(key)
  const source = text[file] ?? ''
  const at = sourceLocator(file, source)
  const diagnostics: WorkspaceDiagnostic[] = []
  const report = (start: number, end: number, message: string) => {
    diagnostics.push(
      diagnostic('E_SKILL_FRONTMATTER', message, {
        kind: 'skill',
        key,
        ...at.located(at.span(start, end)),
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
    if (!isOneOf(FIELDS, field) || line[colon + 1] !== ' ') {
      report(
        at,
        at + line.length,
        isOneOf(FIELDS, field) || colon === -1
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

/** Reads and prints `skills/<key>.md`. */
export const skillCodec: KindCodec<SkillDecl> = {
  group: (paths) => groupByFile(KIND_DIRS.skill, [EXTENSION], paths),
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
  /** Content is compared with LF line endings: the CLI reads every text file as LF. */
  canonical: (decl) => ({
    name: decl.name,
    description: decl.description,
    content: decl.content.replace(/\r\n/g, '\n'),
  }),
}
