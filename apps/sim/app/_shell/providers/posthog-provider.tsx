'use client'

import { useEffect } from 'react'
import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'
import { getEnv, isTruthy } from '@/lib/core/config/env'

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
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        capture_performance: false,
        capture_dead_clicks: false,
        enable_heatmaps: false,
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
        persistence: 'localStorage+cookie',
      })
    }
  }, [])

  return <PHProvider client={posthog}>{children}</PHProvider>
}
