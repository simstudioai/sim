import type { CaptureResult } from 'posthog-js'

const URL_PROPERTIES = [
  '$current_url',
  '$referrer',
  '$initial_current_url',
  '$initial_referrer',
] as const

/**
 * Exception types that only ever mean "something was cancelled".
 *
 * `AbortError` is what a fetch rejects with once its `AbortSignal` fires —
 * React Query aborts in-flight queries on unmount and on refetch, so this is
 * routine teardown. `Canceled` is Monaco's `CancellationError`
 * (`monaco-editor/esm/vs/base/common/errors.js` sets both `name` and `message`
 * to the bare string), raised whenever a language-service request is superseded
 * by a newer keystroke.
 *
 * Neither can be acted on: there is no defect to fix and no user impact, but
 * both fire often enough per session to bury real crashes in the issue list.
 */
const CANCELLATION_ERROR_NAMES = new Set(['AbortError', 'Canceled'])

/**
 * Exception messages that carry no diagnosable content.
 *
 * `ResizeObserver loop …` is the browser reporting that a resize callback
 * dirtied layout again before delivery. It is specified behaviour, not an
 * error: the observer simply defers the remaining notifications to the next
 * frame. It has no stack that points anywhere useful and fires constantly in
 * resizable/canvas UIs — it was 92% of everything captured in the first days of
 * error tracking. Both the current wording and the older `loop limit exceeded`
 * spelling are matched.
 *
 * `Script error.` is what `window.onerror` reports for a cross-origin script
 * served without CORS headers. The browser withholds the message, the file, and
 * the stack, so nothing about it is recoverable.
 *
 * Matched by prefix because browsers disagree about the trailing period.
 */
const UNDIAGNOSABLE_EXCEPTION_MESSAGES = [
  'ResizeObserver loop completed with undelivered notifications',
  'ResizeObserver loop limit exceeded',
  'Script error.',
]

interface CapturedException {
  type?: unknown
  value?: unknown
  mechanism?: { handled?: unknown }
}

/**
 * Whether the browser raised this itself, rather than us reporting it on purpose.
 *
 * PostHog's `window.onerror` and `unhandledrejection` wrappers both build their
 * exception with `mechanism.handled: false`, while `captureException` — the call
 * our error boundaries make — builds with `true`. Only the browser's own reports
 * are eligible for filtering: a deliberate report means someone decided the
 * failure was worth knowing about, and dropping it would repeat the silent loss
 * this filter's sibling gate exists to prevent.
 *
 * Read from the first entry only. When an error carries a `cause`, PostHog
 * appends the chained links with `handled: true` regardless of how the original
 * was raised, so the head of the list is the one that reflects the source.
 */
function isBrowserRaised(exceptions: CapturedException[]): boolean {
  return exceptions[0]?.mechanism?.handled === false
}

/**
 * Whether this is a cancellation, testing both shapes PostHog can produce.
 *
 * Which field carries the error's `name` depends on which coercer ran. A plain
 * `Error` keeps its `name` as `type`, so Monaco's `CancellationError` arrives as
 * type `Canceled`. A `DOMException` — what `fetch` rejects with when its signal
 * fires — always coerces to type `DOMException`, with the name folded into the
 * front of the value as `"AbortError: signal is aborted without reason"`.
 * Matching on `type` alone therefore misses every real aborted request.
 */
function isCancellation(exception: CapturedException): boolean {
  if (typeof exception.type === 'string' && CANCELLATION_ERROR_NAMES.has(exception.type)) {
    return true
  }

  if (typeof exception.value !== 'string') return false

  return CANCELLATION_ERROR_NAMES.has(exception.value.split(':', 1)[0])
}

function isNoise(exception: CapturedException): boolean {
  if (isCancellation(exception)) return true

  if (typeof exception.value !== 'string') return false
  const message = exception.value.trim()

  return UNDIAGNOSABLE_EXCEPTION_MESSAGES.some((prefix) => message.startsWith(prefix))
}

/**
 * `before_send` hook that drops browser noise from error tracking.
 *
 * Fails open in every direction: anything that is not a `$exception`, any
 * `$exception` whose list is missing or unrecognizable, and anything we
 * reported deliberately rather than caught from the browser, all pass through
 * untouched. This runs on **every** captured event, so a filter that guessed
 * wrong would silently delete product analytics rather than merely over-report.
 *
 * A chained exception is dropped only when *every* link is noise — one benign
 * link must not hide a real error it was raised alongside.
 *
 * @param event - The event PostHog is about to send, or `null` if an earlier
 *   hook already dropped it.
 * @returns The event to send, or `null` to drop it.
 */
export function dropUnactionableExceptions(event: CaptureResult | null): CaptureResult | null {
  if (!event || event.event !== '$exception') return event

  const exceptions: unknown = event.properties?.$exception_list
  if (!Array.isArray(exceptions) || exceptions.length === 0) return event

  const entries: CapturedException[] = exceptions.filter(
    (exception): exception is CapturedException =>
      typeof exception === 'object' && exception !== null
  )
  if (entries.length !== exceptions.length) return event

  if (!isBrowserRaised(entries)) return event

  return entries.every(isNoise) ? null : event
}

function stripUrlQuery(value: unknown): unknown {
  if (typeof value !== 'string') return value

  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    const queryIndex = value.search(/[?#]/)
    return queryIndex === -1 ? value : value.slice(0, queryIndex)
  }
}

/** Removes URL secrets before applying the browser-exception noise filter. */
export function preparePostHogEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event?.properties) return dropUnactionableExceptions(event)

  let sanitizedProperties: CaptureResult['properties'] | null = null
  for (const property of URL_PROPERTIES) {
    const value = event.properties[property]
    const sanitizedValue = stripUrlQuery(value)
    if (sanitizedValue === value) continue
    sanitizedProperties ??= { ...event.properties }
    sanitizedProperties[property] = sanitizedValue
  }

  const sanitizedEvent = sanitizedProperties ? { ...event, properties: sanitizedProperties } : event
  return dropUnactionableExceptions(sanitizedEvent)
}
