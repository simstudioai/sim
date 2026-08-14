'use client'

import { useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import type { PostHog } from 'posthog-js'
import { getEnv, isTruthy, publicEnvMissingAtModuleInit } from '@/lib/core/config/env'

const logger = createLogger('PostHogProvider')

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const [Provider, setProvider] = useState<React.ComponentType<{
    client: PostHog
    children: React.ReactNode
  }> | null>(null)
  const clientRef = useRef<PostHog | null>(null)

  useEffect(() => {
    const posthogEnabled = getEnv('NEXT_PUBLIC_POSTHOG_ENABLED')
    const posthogKey = getEnv('NEXT_PUBLIC_POSTHOG_KEY')

    if (!isTruthy(posthogEnabled) || !posthogKey) return

    Promise.all([import('posthog-js'), import('posthog-js/react')])
      .then(([posthogModule, { PostHogProvider: PHProvider }]) => {
        const posthog = posthogModule.default
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
        if (publicEnvMissingAtModuleInit) {
          posthog.capture('runtime_env_missing_at_module_init')
        }
        clientRef.current = posthog
        setProvider(() => PHProvider)
      })
      .catch((err) => {
        logger.error('Failed to load PostHog', { error: err })
      })
  }, [])

  if (Provider && clientRef.current) {
    return <Provider client={clientRef.current}>{children}</Provider>
  }

  return <>{children}</>
}
