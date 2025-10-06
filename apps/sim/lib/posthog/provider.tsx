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
        capture_pageleave: true,
        capture_performance: true,
        session_recording: {
          maskAllInputs: false,
          maskInputOptions: {
            password: true,
            email: false,
          },
          recordCrossOriginIframes: false,
          recordHeaders: true,
          recordBody: true,
        },
        autocapture: true,
        capture_dead_clicks: true,
        persistence: 'localStorage+cookie',
        enable_heatmaps: true,
      })
    }
  }, [])

  return <PHProvider client={posthog}>{children}</PHProvider>
}
