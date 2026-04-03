import type { PostHogEventMap, PostHogEventName } from '@/lib/posthog/events'

/**
 * Capture a client-side PostHog event from a non-React context (e.g. Zustand stores).
 *
 * Uses the same dynamic `import('posthog-js')` pattern as `session-provider.tsx`.
 * Fully fire-and-forget — never throws, never blocks.
 *
 * React components should use `usePostHog()` from `posthog-js/react` instead.
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
