// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
import * as Sentry from '@sentry/nextjs'
import { env } from './lib/env'

// Completely skip Sentry initialization in development
if (env.NODE_ENV === 'production') {
  Sentry.init({
    dsn: env.NEXT_PUBLIC_SENTRY_DSN || undefined,
    enabled: true,
    environment: env.NODE_ENV || 'development',
    tracesSampleRate: 0.2,

    beforeSend(event) {
      if (event.request && typeof event.request === 'object') {
        ;(event.request as any).ip = null
      }
      return event
    },
  })
}
