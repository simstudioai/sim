import { LARGE_VALUE_REF_MARKER } from '@/lib/execution/payloads/large-value-ref'
import { SPAN_SOURCE_OUTPUT_FIELDS } from '@/lib/logs/execution/trace-spans/factory'

/**
 * Whether a block's own handler alone may set this top-level output field: a `_` field steers
 * the executor (a pause, a child-run link), and the run's trace and bill are built from the
 * {@link SPAN_SOURCE_OUTPUT_FIELDS}.
 */
export function isRunControlledOutputField(field: string): boolean {
  return field.startsWith('_') || SPAN_SOURCE_OUTPUT_FIELDS.has(field)
}

/** Whether `value` holds a large-value reference at any depth. */
function holdsLargeValueRef(value: unknown): boolean {
  const pending: unknown[] = [value]
  while (pending.length > 0) {
    const next = pending.pop()
    if (next === null || typeof next !== 'object') continue
    if (Object.hasOwn(next, LARGE_VALUE_REF_MARKER)) return true
    pending.push(...Object.values(next))
  }
  return false
}

/**
 * Why a mocked output, named by `label`, is refused; null when it sets only data. A mock (a dry
 * run's `run.mocks`, or a workflow test's `mockBlock`) is data, never run control or billing, and
 * carries its data inline: a large-value reference would read a value this run was never granted.
 */
export function mockOutputRefusal(label: string, output: Record<string, unknown>): string | null {
  const fields = Object.keys(output).filter(isRunControlledOutputField)
  if (fields.length > 0) {
    return `${label} sets ${fields.join(', ')}: a mock is data, so it cannot set a field the run's execution, trace or billing reads (${[...SPAN_SOURCE_OUTPUT_FIELDS].join(', ')}, or any field starting with "_").`
  }
  if (holdsLargeValueRef(output)) {
    return `${label} holds a large-value reference (an object with ${LARGE_VALUE_REF_MARKER}): a mock carries its data inline.`
  }
  return null
}
