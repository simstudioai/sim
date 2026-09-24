import { isRecordLike, toArray } from '@sim/utils/object'

/** Detects recovered errors in trace structure without inspecting user-provided span IO. */
export function traceSpansHaveHandledErrors(spans: unknown): boolean {
  return toArray<unknown>(spans).some(
    (span) =>
      isRecordLike(span) &&
      ((span.status === 'error' && span.errorHandled === true) ||
        traceSpansHaveHandledErrors(span.children))
  )
}
