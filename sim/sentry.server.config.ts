// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  enabled: process.env.NODE_ENV === 'production',
  environment: process.env.NODE_ENV || 'development',
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1,
  debug: process.env.NODE_ENV === 'development',
  
  beforeSend(event) {
    if (process.env.NODE_ENV !== 'production') return null
    
    if (event.request && typeof event.request === 'object') {
      (event.request as any).ip = null
    }
    return event
  },
})
