import { useEffect, useEffectEvent, useRef, useSyncExternalStore } from 'react'
import {
  captureClientEvent,
  isPostHogClientReady,
  subscribePostHogClient,
} from '@/lib/posthog/client'
import type { PostHogEventMap, PostHogEventName } from '@/lib/posthog/events'

/**
 * Captures a view-style event once per `key`, as soon as the consented PostHog
 * client is published. A capture made directly in a mount effect is dropped on
 * a hard load: `PostHogProvider` publishes the client in its own effect once
 * consent resolves, and React runs a component's mount effects before its
 * ancestors'. Nothing is buffered, so a visitor who never consents is never
 * captured.
 *
 * @param properties - The event's properties, or `null` to hold the capture
 *   until its inputs exist (a loading session, an unresolved route param).
 * @param key - Re-captures when it changes, e.g. the pathname or the open
 *   resource's id. Defaults to once per mount.
 */
export function useCaptureWhenReady<E extends PostHogEventName>(
  event: E,
  properties: PostHogEventMap[E] | null,
  key: string = event
): void {
  const isReady = useSyncExternalStore(subscribePostHogClient, isPostHogClientReady, () => false)
  const lastCapturedKeyRef = useRef<string | null>(null)
  const hasProperties = properties !== null

  const capture = useEffectEvent(() => {
    if (properties) captureClientEvent(event, properties)
  })

  useEffect(() => {
    if (!isReady || !hasProperties || lastCapturedKeyRef.current === key) return
    lastCapturedKeyRef.current = key
    capture()
  }, [isReady, hasProperties, key])
}
