/**
 * Field checks a kind runs over a decoded declaration: each finding is pinned to the line of the
 * value it is about (or the nearest enclosing value the reader kept a span for).
 */
import { isRecordLike } from '@sim/utils/object'
import type { Json, SourceSpan } from '@sim/workflow-code'
import {
  diagnostic,
  sourceLocator,
  type WorkspaceDiagnostic,
  type WorkspaceDiagnosticCode,
} from '../diagnostics'
import { pointerSegment } from './read'

/** Reports one finding at the value under a JSON Pointer. */
export type FieldReport = (
  code: WorkspaceDiagnosticCode,
  pointer: string,
  message: string,
  hint?: string
) => void

/** A {@link FieldReport} that appends to `diagnostics`, located through the reader's spans. */
export function fieldReporter(
  text: string,
  spans: ReadonlyMap<string, SourceSpan>,
  diagnostics: WorkspaceDiagnostic[],
  resource: { kind: string; key: string }
): FieldReport {
  let locator: ReturnType<typeof sourceLocator> | undefined
  return (code, pointer, message, hint) => {
    let at = pointer
    let span = spans.get(at)
    while (!span && at !== '') {
      at = at.slice(0, Math.max(0, at.lastIndexOf('/')))
      span = spans.get(at)
    }
    diagnostics.push(
      diagnostic(code, message, {
        ...resource,
        ...(span ? (locator ??= sourceLocator(span.file, text)).located(span) : {}),
        ...(hint ? { hint } : {}),
      })
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

/** `value[field]` as a string, reporting a wrong type (and a missing one when `required`). */
export function readStringField(
  value: Record<string, Json>,
  field: string,
  pointer: string,
  report: FieldReport,
  options: { required?: boolean; maxLength?: number } = {}
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

/** `value` as an object, reporting anything else. */
export function readObject(
  value: Json | undefined,
  pointer: string,
  report: FieldReport,
  what: string
): Record<string, Json> | undefined {
  if (isRecordLike(value) && !Array.isArray(value)) return value as Record<string, Json>
  report('E_DECL_SHAPE', pointer, `${what} must be an object.`)
  return undefined
}
