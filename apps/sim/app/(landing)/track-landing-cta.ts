import { captureClientEvent } from '@/lib/posthog/client'
import type { PostHogEventMap } from '@/lib/posthog/events'

/**
 * Fire-and-forget tracker for landing page CTA clicks.
 * Uses the non-hook client so it works in any click handler without requiring a PostHog provider ref.
 */
export function trackLandingCta(props: PostHogEventMap['landing_cta_clicked']): void {
  captureClientEvent('landing_cta_clicked', props)
}
