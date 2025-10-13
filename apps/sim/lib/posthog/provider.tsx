'use client'

import { useEffect } from 'react'
import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'
import { getEnv, isTruthy } from '../env'

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const posthogEnabled = getEnv('NEXT_PUBLIC_POSTHOG_ENABLED')
    const posthogKey = getEnv('NEXT_PUBLIC_POSTHOG_KEY')

    if (isTruthy(posthogEnabled) && posthogKey && !posthog.__loaded) {
      posthog.init(posthogKey, {
        api_host: '/ingest',
        ui_host: 'https://us.posthog.com',
        defaults: '2025-05-24',
        person_profiles: 'identified_only',
        capture_pageview: true,
        capture_pageleave: false,
        capture_performance: false,
        session_recording: {
          maskAllInputs: false,
          maskInputOptions: {
            password: true,
            email: false,
          },
          recordCrossOriginIframes: false,
          recordHeaders: false,
          recordBody: false,
        },
        autocapture: {
          dom_event_allowlist: ['click', 'submit', 'change'],
          element_allowlist: ['button', 'a', 'input'],
        },
        capture_dead_clicks: false,
        persistence: 'localStorage+cookie',
        enable_heatmaps: false,
      })
    }
  }, [])

  return <PHProvider client={posthog}>{children}</PHProvider>
}
