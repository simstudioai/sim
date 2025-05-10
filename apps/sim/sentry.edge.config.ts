// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
import * as Sentry from '@sentry/nextjs'

// Completely skip Sentry initialization in development
if (process.env.NODE_ENV === 'production') {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
    enabled: true,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.2,

    beforeSend(event) {
      if (event.request && typeof event.request === 'object') {
        ;(event.request as any).ip = null
      }
      return event
    },
  })
}
