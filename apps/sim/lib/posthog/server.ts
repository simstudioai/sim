import { createLogger } from '@sim/logger'
import type { PostHogEventMap, PostHogEventName } from '@/lib/posthog/events'

const logger = createLogger('PostHogServer')

let _client: import('posthog-node').PostHog | null = null
let _disabled = false

export function getPostHogClient(): import('posthog-node').PostHog | null {
  return getClient()
}

function getClient(): import('posthog-node').PostHog | null {
  if (_disabled) return null
  if (_client) return _client

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  const enabled = process.env.NEXT_PUBLIC_POSTHOG_ENABLED

  if (!key || !enabled || enabled === 'false' || enabled === '0') {
    _disabled = true
    return null
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PostHog } = require('posthog-node') as typeof import('posthog-node')
  _client = new PostHog(key, {
    host: 'https://us.i.posthog.com',
    flushAt: 20,
    flushInterval: 10_000,
  })
  return _client
}

type PersonProperties = Record<string, string | number | boolean>

interface CaptureOptions {
  /**
   * Associate this event with workspace-level group analytics.
   * Pass `{ workspace: workspaceId }`.
   */
  groups?: Record<string, string>
  /**
   * Person properties to update on every capture (`$set`).
   * Use for mutable state like `plan`, `total_workflows`.
   */
  set?: PersonProperties
  /**
   * Person properties to set only once (`$set_once`).
   * Use for immutable milestones like `first_execution_at`.
   */
  setOnce?: PersonProperties
}

/**
 * Capture a server-side PostHog event. Fire-and-forget — never throws.
 *
 * @param distinctId - The user (or workspace/org) ID to associate the event with.
 * @param event      - Typed event name from {@link PostHogEventMap}.
 * @param properties - Strongly-typed property bag for this event.
 * @param options    - Optional groups, $set, and $set_once person properties.
 */
export function captureServerEvent<E extends PostHogEventName>(
  distinctId: string,
  event: E,
  properties: PostHogEventMap[E],
  options?: CaptureOptions
): void {
  try {
    const client = getClient()
    if (!client) return

    client.capture({
      distinctId,
      event,
      properties: {
        ...properties,
        ...(options?.groups ? { $groups: options.groups } : {}),
        ...(options?.set ? { $set: options.set } : {}),
        ...(options?.setOnce ? { $set_once: options.setOnce } : {}),
      },
    })
  } catch (error) {
    logger.warn('Failed to capture PostHog server event', { event, error })
  }
}
