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

import { hasSuspiciousCharacter } from '@sim/workflow-code'
import {
  asDeclared,
  canonicalFields,
  type DeclField,
  type DeclFields,
  printFields,
} from '../declaration/field-table'
import { type FieldReport, SUSPICIOUS_CHARACTER_HINT } from '../declaration/fields'
import { unstorableCharacter } from '../declaration/read'
import { diagnostic, resourceOf, sourceLocator, type WorkspaceDiagnostic } from '../diagnostics'
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
/** The field the codec reads, prints and fingerprints itself: everything after the frontmatter. */
const CONTENT_FIELD = 'content' satisfies keyof SkillDecl

type Frontmatter = Omit<SkillDecl, typeof CONTENT_FIELD>

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

/**
 * A frontmatter value: read from the raw text after `field: ` (plain, or a JSON string), printed
 * as {@link printValue} writes it, and fingerprinted as declared.
 */
const frontmatterField: DeclField<string | undefined> = {
  read(value, field, pointer, report) {
    const raw = value[field]
    if (typeof raw !== 'string') return undefined
    const parsed = raw.startsWith('"') ? readQuoted(raw) : isPlain(raw) ? raw : null
    if (parsed === null) {
      report(
        'E_SKILL_FRONTMATTER',
        pointer,
        raw.startsWith('"')
          ? `The ${field} is not a valid quoted string.`
          : `Quote the ${field} ("…"): it is empty or holds characters plain text cannot.`
      )
      return undefined
    }
    const problem = unstorableCharacter(parsed)
    if (problem) {
      report(
        'E_SKILL_FRONTMATTER',
        pointer,
        `The ${field} holds ${problem}, which cannot be stored.`
      )
      return undefined
    }
    return parsed
  },
  print: (value) => (value === undefined ? undefined : printValue(value)),
  canonical: asDeclared,
}

/** The frontmatter fields, in print order; the content is the codec's own. */
const FRONTMATTER_FIELDS: DeclFields<Frontmatter> = {
  name: frontmatterField,
  description: frontmatterField,
}

function isFrontmatterField(field: string): field is keyof Frontmatter {
  return Object.hasOwn(FRONTMATTER_FIELDS, field)
}

function parseSkill(
  key: string,
  text: Readonly<Record<string, string>>
): { decl?: SkillDecl; diagnostics: WorkspaceDiagnostic[] } {
  const file = skillPath(key)
  const source = text[file] ?? ''
  const locator = sourceLocator(file, source)
  const diagnostics: WorkspaceDiagnostic[] = []
  const report = (start: number, end: number, message: string) => {
    diagnostics.push(
      diagnostic('E_SKILL_FRONTMATTER', message, {
        ...resourceOf('skill', key),
        ...locator.located(locator.span(start, end)),
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
  const values: Partial<Frontmatter> = {}
  const attempted = new Set<string>()
  let offset = open.length
  for (const line of close < offset ? [] : source.slice(offset, close).split('\n')) {
    const lineStart = offset
    offset += line.length + 1
    const colon = line.indexOf(':')
    const field = colon === -1 ? '' : line.slice(0, colon)
    if (!isFrontmatterField(field) || line[colon + 1] !== ' ') {
      report(
        lineStart,
        lineStart + line.length,
        isFrontmatterField(field) || colon === -1
          ? 'Each frontmatter line is `field: value`.'
          : `Unknown frontmatter field "${field}"; a skill has only name and description.`
      )
      continue
    }
    if (attempted.has(field)) {
      report(lineStart, lineStart + line.length, `"${field}" is declared twice.`)
      continue
    }
    attempted.add(field)
    const reportLine: FieldReport = (_code, _pointer, message) =>
      report(lineStart, lineStart + line.length, message)
    const value = FRONTMATTER_FIELDS[field].read(
      { [field]: line.slice(colon + 2) },
      field,
      `/${field}`,
      reportLine
    )
    if (value === undefined) continue
    values[field] = value
    if (field === 'name' && hasSuspiciousCharacter(value)) {
      diagnostics.push(
        diagnostic(
          'W_DECL_SUSPICIOUS_CHARACTER',
          'The name holds an invisible bidi control or zero-width character.',
          {
            ...resourceOf('skill', key),
            ...locator.located(locator.span(lineStart, lineStart + line.length)),
            hint: SUSPICIOUS_CHARACTER_HINT,
          }
        )
      )
    }
  }
  for (const field of Object.keys(FRONTMATTER_FIELDS)) {
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
  if (
    diagnostics.some((finding) => finding.severity === 'error') ||
    values.name === undefined ||
    values.description === undefined
  ) {
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
        ...Object.entries(printFields(FRONTMATTER_FIELDS, decl)).map(
          ([field, value]) => `${field}: ${value}`
        ),
        FENCE,
        decl[CONTENT_FIELD],
      ].join('\n'),
    },
    blobs: [],
  }),
  /** Content is compared with LF line endings: the CLI reads every text file as LF. */
  canonical: (decl) => ({
    ...canonicalFields(FRONTMATTER_FIELDS, decl),
    [CONTENT_FIELD]: decl[CONTENT_FIELD].replace(/\r\n/g, '\n'),
  }),
}
