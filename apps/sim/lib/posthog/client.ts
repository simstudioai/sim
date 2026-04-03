import type { PostHog } from 'posthog-js'
import type { PostHogEventMap, PostHogEventName } from '@/lib/posthog/events'

/**
 * Capture a client-side PostHog event from a non-React context (e.g. Zustand stores).
 *
 * Uses the same dynamic `import('posthog-js')` pattern as `session-provider.tsx`.
 * Fully fire-and-forget — never throws, never blocks.
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
  import('posthog-js')
    .then(({ default: posthog }) => {
      try {
        if (typeof posthog.capture === 'function') {
          posthog.capture(event, properties)
        }
      } catch {}
    })
    .catch(() => {})
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
