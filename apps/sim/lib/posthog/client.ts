import type { PostHog } from 'posthog-js'
import type { PostHogEventMap, PostHogEventName } from '@/lib/posthog/events'

/**
 * The currently consented, initialized PostHog client. Events raised before
 * initialization or after consent withdrawal are intentionally dropped rather
 * than buffered and replayed after the user's privacy decision changes.
 */
let postHogClient: PostHog | null = null

/**
 * Publishes or clears the consented PostHog client used by non-React callers.
 * Called only by `PostHogProvider`.
 *
 * @param instance - The initialized instance, or `null` when analytics is off.
 */
export function setPostHogClient(instance: PostHog | null): void {
  postHogClient = instance
}

/**
 * Runs a capture against the currently consented client, swallowing everything.
 * Analytics is fire-and-forget and must never fail an application path.
 */
function captureIfReady(send: (posthog: PostHog) => void): void {
  if (!postHogClient) return
  try {
    send(postHogClient)
  } catch {}
}

/**
 * Capture a client-side PostHog event from a non-React context (e.g. Zustand stores).
 *
 * Fully fire-and-forget — never throws, never blocks. Events captured before
 * consent and initialization are dropped.
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
  captureIfReady((posthog) => {
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
  captureIfReady((posthog) => {
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
