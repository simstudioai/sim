'use client'

import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'
import { useTrackingConsent } from '@/lib/consent/tracking-consent'
import { getEnv, isTruthy, publicEnvMissingAtModuleInit } from '@/lib/core/config/env'
import { setPostHogClient } from '@/lib/posthog/client'
import { preparePostHogEvent } from '@/lib/posthog/exception-filter'

const logger = createLogger('PostHogProvider')

/** Removes this PostHog project's browser state after a settled analytics denial. */
function clearPostHogBrowserState(posthogKey: string): void {
  const persistenceKey = `ph_${posthogKey
    .replace(/\+/g, 'PL')
    .replace(/\//g, 'SL')
    .replace(/=/g, 'EQ')}_posthog`
  const storageKeys = [
    persistenceKey,
    `ph_${posthogKey}_window_id`,
    `ph_${posthogKey}_primary_window_exists`,
    `__ph_opt_in_out_${posthogKey}`,
  ]

  try {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      for (const key of storageKeys) storage.removeItem(key)
    }
  } catch {}

  try {
    const simDomain =
      window.location.hostname === 'sim.ai' || window.location.hostname.endsWith('.sim.ai')
        ? '; Domain=.sim.ai'
        : ''

    for (const key of storageKeys) {
      document.cookie = `${key}=; Max-Age=0; Path=/; SameSite=Lax`
      if (simDomain) document.cookie = `${key}=; Max-Age=0; Path=/; SameSite=Lax${simDomain}`
    }
  } catch {}
}

interface PostHogProviderProps {
  children: React.ReactNode
  consentRequired?: boolean
}

export function PostHogProvider({ children, consentRequired = false }: PostHogProviderProps) {
  const { isResolved, measurement } = useTrackingConsent()
  const canInitialize = !consentRequired || (isResolved && measurement)

  useEffect(() => {
    const posthogKey = getEnv('NEXT_PUBLIC_POSTHOG_KEY')

    if (!canInitialize) {
      setPostHogClient(null)
      if (posthog.__loaded) posthog.opt_out_capturing()
      if (consentRequired && isResolved && !measurement && posthogKey) {
        clearPostHogBrowserState(posthogKey)
      }
      return () => setPostHogClient(null)
    }

    const posthogEnabled = getEnv('NEXT_PUBLIC_POSTHOG_ENABLED')

    if (!isTruthy(posthogEnabled) || !posthogKey) {
      setPostHogClient(null)
      if (posthog.__loaded) posthog.opt_out_capturing()
      return () => setPostHogClient(null)
    }

    try {
      if (!posthog.__loaded) {
        posthog.init(posthogKey, {
          api_host: '/ingest',
          ui_host: 'https://us.posthog.com',
          defaults: '2025-05-24',
          person_profiles: 'identified_only',
          autocapture: false,
          capture_pageview: false,
          capture_pageleave: false,
          capture_performance: false,
          capture_dead_clicks: false,
          enable_heatmaps: false,
          /**
           * PostHog's own error tracking, wired to `window.onerror` and
           * `unhandledrejection`. This is the app-wide net: React error
           * boundaries only see errors thrown inside the tree they wrap, and
           * a failed chunk load, a rejected promise, or anything thrown from
           * an event handler or socket callback reaches none of them.
           *
           * `capture_console_errors` stays off. It is not error reporting —
           * it captures every `console.error`, which here means React's
           * hydration and dev warnings (the ones `HydrationErrorHandler`
           * already filters out as noise) drowning the real exceptions.
           */
          capture_exceptions: {
            capture_unhandled_errors: true,
            capture_unhandled_rejections: true,
            capture_console_errors: false,
          },
          /**
           * Drops the browser artifacts that autocapture cannot help but
           * see — resize-loop notices, opaque cross-origin failures, and
           * cancelled requests. Filtering here rather than with a PostHog
           * suppression rule keeps the list reviewable in the diff and stops
           * the events before they leave the browser.
           */
          before_send: preparePostHogEvent,
          opt_out_capturing_by_default: true,
          opt_out_persistence_by_default: true,
          disable_session_recording: true,
          session_recording: {
            maskAllInputs: false,
            maskInputOptions: {
              password: true,
              email: false,
            },
            /**
             * None of these nodes are painted, so replay fidelity is
             * unchanged, while each full snapshot serializes fewer nodes on
             * the main thread and ships a smaller payload.
             *
             * Enumerated rather than `true`/`'all'` on purpose — those
             * presets also enable `headTitleMutations`, which would drop
             * `document.title` changes and lose the page identity a replay
             * viewer reads while scrubbing.
             */
            slimDOMOptions: {
              script: true,
              comment: true,
              headFavicon: true,
              headWhitespace: true,
              headMetaDescKeywords: true,
              headMetaSocial: true,
              headMetaRobots: true,
              headMetaHttpEquiv: true,
              headMetaAuthorship: true,
              headMetaVerification: true,
            },
            recordCrossOriginIframes: false,
            recordHeaders: false,
            recordBody: false,
          },
          persistence: 'localStorage+cookie',
        })
      }
      /**
       * A prior withdrawal persists PostHog's opt-out marker. c15t is the
       * source of truth, so a settled grant must explicitly clear that marker
       * without emitting PostHog's synthetic opt-in event.
       */
      posthog.opt_in_capturing({ captureEventName: false })
      setPostHogClient(posthog)

      if (publicEnvMissingAtModuleInit) {
        posthog.capture('runtime_env_missing_at_module_init')
      }
    } catch (err) {
      setPostHogClient(null)
      logger.error('Failed to load PostHog', { error: err })
    }

    return () => {
      setPostHogClient(null)
    }
  }, [canInitialize, consentRequired, isResolved, measurement])

  return <PHProvider client={posthog}>{children}</PHProvider>
}
