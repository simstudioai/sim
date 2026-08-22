import type { PostHog } from 'posthog-js'
import type { PostHogEventMap, PostHogEventName } from '@/lib/posthog/events'

/**
 * Resolves with the initialized PostHog instance, or `null` when analytics is
 * disabled or the library failed to load. Settled exactly once by
 * {@link settlePostHogClient}, which `PostHogProvider` calls on every branch.
 *
 * This gate exists because `posthog.capture` is a hard no-op until
 * `posthog.init()` has run: its entire body sits behind `if (this.__loaded)`,
 * with no buffer and no warning, so a call made before init is discarded
 * silently. `PostHogProvider` reaches init through two dynamic imports
 * (`posthog-js` and `posthog-js/react`), while a caller only needs `posthog-js`
 * — so anything captured on mount resolves first and lands in that dead window.
 * Mount-time events (`login_page_viewed`, `landing_page_viewed`) and, worst of
 * all, a crash report from an error boundary that fired during first paint were
 * the events most reliably lost.
 */
let settlePostHog!: (instance: PostHog | null) => void
const postHogReady = new Promise<PostHog | null>((resolve) => {
  settlePostHog = resolve
})

/**
 * Publishes the outcome of PostHog initialization to the capture helpers.
 * Called only by `PostHogProvider`. Repeat calls are no-ops.
 *
 * @param instance - The initialized instance, or `null` when analytics is off.
 */
export function settlePostHogClient(instance: PostHog | null): void {
  settlePostHog(instance)
}

/**
 * Runs `send` once PostHog is ready, swallowing everything. Analytics must
 * never surface as an unhandled rejection — these helpers are called from
 * error-reporting paths, where a throw would be captured as its own exception.
 */
function whenReady(send: (posthog: PostHog) => void): void {
  postHogReady
    .then((posthog) => {
      if (posthog) send(posthog)
    })
    .catch(() => {})
}

/**
 * Capture a client-side PostHog event from a non-React context (e.g. Zustand stores).
 *
 * Fully fire-and-forget — never throws, never blocks. Events captured before
 * PostHog finishes initializing are held until it does rather than dropped.
 *
 * React components should use {@link captureEvent} with the `posthog` instance from `usePostHog()`.
 *
 * @param event      - Typed event name from {@link PostHogEventMap}.
 * @param properties - Strongly-typed property bag for this event.
 */
export function captureClientEvent<E extends PostHogEventName>(
  event: E,
  properties: PostHogEventMap[E]
): void {
  whenReady((posthog) => {
    posthog.capture(event, properties as Record<string, unknown>)
  })
}

/**
 * Report a caught error to PostHog Error Tracking.
 *
 * This is what puts a failure in front of the error tracker: `captureException`
 * emits a `$exception` event carrying `$exception_list` — the parsed type,
 * message, and stack frames that error tracking groups into an issue and links
 * to a session replay. A custom event with the message copied into a string
 * property looks equivalent on a dashboard but is invisible to that product,
 * carries no stack, and cannot be grouped or resolved.
 *
 * @param error      - The caught value. Coerced by PostHog into an exception list.
 * @param properties - Extra context merged onto the `$exception` event.
 */
export function captureClientException(error: unknown, properties?: Record<string, unknown>): void {
  whenReady((posthog) => {
    posthog.captureException(error, properties)
  })
}

/**
 * Typed wrapper for `posthog.capture` in React components.
 *
 * Enforces event names and property shapes from {@link PostHogEventMap} at compile time,
 * matching the type safety provided by `captureServerEvent` on the server side.
 *
 * @param posthog    - PostHog instance from `usePostHog()`.
 * @param event      - Typed event name from {@link PostHogEventMap}.
 * @param properties - Strongly-typed property bag for this event.
 */
export function captureEvent<E extends PostHogEventName>(
  posthog: PostHog | null | undefined,
  event: E,
  properties: PostHogEventMap[E]
): void {
  posthog?.capture(event, properties as Record<string, unknown>)
}
