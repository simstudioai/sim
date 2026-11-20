/**
 * Field checks a kind runs over a decoded declaration: each finding is pinned to the line of the
 * value it is about (or the nearest enclosing value the reader kept a span for).
 */
import { isRecordLike } from '@sim/utils/object'
import {
  hasSuspiciousCharacter,
  type Json,
  pointerSegment,
  type SourceSpan,
} from '@sim/workflow-code'
import {
  diagnostic,
  type FindingResource,
  findingLimitReached,
  MAX_FINDINGS_PER_FILE,
  sourceLocator,
  type WorkspaceDiagnostic,
  type WorkspaceDiagnosticCode,
} from '../diagnostics'
import { notAnObject } from './read'

/** Reports one finding at the value under a JSON Pointer. */
export type FieldReport = (
  code: WorkspaceDiagnosticCode,
  pointer: string,
  message: string,
  hint?: string
) => void

/**
 * Codes whose finding is about a literal secret written in the file: they carry a span but never a
 * code frame, so the secret is not echoed back over the API into logs or agent context.
 */
const SECRET_VALUE_CODES: ReadonlySet<WorkspaceDiagnosticCode> = new Set([
  'E_DEPLOY_SECRET',
  'E_MCP_LITERAL_SECRET',
  'W_TOOL_LITERAL_SECRET',
])

/**
 * A {@link FieldReport} that appends to `diagnostics`, located through the reader's spans. Once it
 * has appended `MAX_FINDINGS_PER_FILE` findings (findings already in `diagnostics`, such as ones
 * about other files of the resource, do not count) it records one `I_FINDINGS_TRUNCATED` (with a span
 * but no frame, since the value it points at may be a secret) and drops the rest.
 */
export function fieldReporter(
  text: string,
  spans: ReadonlyMap<string, SourceSpan>,
  diagnostics: WorkspaceDiagnostic[],
  resource: FindingResource
): FieldReport {
  let locator: ReturnType<typeof sourceLocator> | undefined
  let capped = false
  const start = diagnostics.length
  return (code, pointer, message, hint) => {
    if (capped) return
    let at = pointer
    let span = spans.get(at)
    while (!span && at !== '') {
      at = at.slice(0, Math.max(0, at.lastIndexOf('/')))
      span = spans.get(at)
    }
    if (diagnostics.length - start >= MAX_FINDINGS_PER_FILE) {
      capped = true
      diagnostics.push(findingLimitReached({ ...resource, ...(span ? { span } : {}) }))
      return
    }
    const location = !span
      ? {}
      : SECRET_VALUE_CODES.has(code)
        ? { span }
        : (locator ??= sourceLocator(span.file, text)).located(span)
    diagnostics.push(
      diagnostic(code, message, { ...resource, ...location, ...(hint ? { hint } : {}) })
    )
  }
}

/** The pointer to `field` under `pointer`. */
export function fieldPointer(pointer: string, field: string | number): string {
  return `${pointer}/${pointerSegment(field)}`
}

/** Reports each field of `value` outside `allowed`. */
export function checkKnownFields(
  value: Record<string, Json>,
  allowed: readonly string[],
  pointer: string,
  report: FieldReport
): void {
  for (const field of Object.keys(value)) {
    if (!allowed.includes(field)) {
      report(
        'E_DECL_UNKNOWN_FIELD',
        fieldPointer(pointer, field),
        `Unknown field "${field}".`,
        `Supported: ${allowed.join(', ')}.`
      )
    }
  }
}

/** What {@link readStringField} checks beside the type. */
export interface StringFieldOptions {
  required?: boolean
  maxLength?: number
  /** The field is a name a reviewer reads: warn on a character that hides or reorders text. */
  name?: boolean
}

/** The hint of `W_DECL_SUSPICIOUS_CHARACTER`. */
export const SUSPICIOUS_CHARACTER_HINT =
  'Remove it, or write it as an escape (\\u202E) so reviewers can see it.'

/**
 * `value[field]` as a string, reporting a wrong type (and a missing one when `required`), and
 * `W_DECL_SUSPICIOUS_CHARACTER` for a `name` that holds a bidi control or zero-width character.
 */
export function readStringField(
  value: Record<string, Json>,
  field: string,
  pointer: string,
  report: FieldReport,
  options: StringFieldOptions = {}
): string | undefined {
  const raw = value[field]
  if (raw === undefined) {
    if (options.required) report('E_DECL_SHAPE', pointer, `"${field}" is required.`)
    return undefined
  }
  if (typeof raw !== 'string' || (options.required && raw.length === 0)) {
    report('E_DECL_SHAPE', fieldPointer(pointer, field), `"${field}" must be a non-empty string.`)
    return undefined
  }
  if (options.maxLength !== undefined && raw.length > options.maxLength) {
    report(
      'E_DECL_SHAPE',
      fieldPointer(pointer, field),
      `"${field}" is longer than ${options.maxLength} characters.`
    )
    return undefined
  }
  if (options.name && hasSuspiciousCharacter(raw)) {
    report(
      'W_DECL_SUSPICIOUS_CHARACTER',
      fieldPointer(pointer, field),
      `"${field}" holds an invisible bidi control or zero-width character.`,
      SUSPICIOUS_CHARACTER_HINT
    )
  }
  return raw
}

/** `value[field]` as a boolean, reporting a wrong type. */
export function readBooleanField(
  value: Record<string, Json>,
  field: string,
  pointer: string,
  report: FieldReport
): boolean | undefined {
  const raw = value[field]
  if (raw === undefined) return undefined
  if (typeof raw !== 'boolean') {
    report('E_DECL_SHAPE', fieldPointer(pointer, field), `"${field}" must be true or false.`)
    return undefined
  }
  return raw
}

/** Whether `value` is one of `values`, narrowing it to their type. */
export function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value)
}

/**
 * `value.folder` as a path from the workspace root (`example`, say), reporting a wrong type or a
 * relative path.
 */
export function readFolderField(
  value: Record<string, Json>,
  report: FieldReport,
  example: string
): string | undefined {
  const folder = readStringField(value, 'folder', '', report)
  if (folder !== undefined && !folder.startsWith('/')) {
    report('E_DECL_SHAPE', '/folder', `folder is a path from the root, such as \`${example}\`.`)
  }
  return folder
}

/** `value` as an object, reporting anything else (a helper call or `env.NAME` included). */
export function readObject(
  value: Json | undefined,
  pointer: string,
  report: FieldReport,
  what: string
): Record<string, Json> | undefined {
  const helper = notAnObject(value)
  if (helper) {
    report(
      'E_DECL_SHAPE',
      pointer,
      `${what} must be an object, but ${helper.message}.`,
      helper.hint
    )
    return undefined
  }
  if (isRecordLike(value)) return value as Record<string, Json>
  report('E_DECL_SHAPE', pointer, `${what} must be an object.`)
  return undefined
}
