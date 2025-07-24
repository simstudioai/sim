/**
 * Sim Studio Telemetry - Client-side Instrumentation
 *
 * This file initializes client-side telemetry when the app loads in the browser.
 * It respects the user's telemetry preferences stored in localStorage.
 *
 */
// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
import {
  BrowserClient,
  breadcrumbsIntegration,
  captureRouterTransitionStart,
  dedupeIntegration,
  defaultStackParser,
  getCurrentScope,
  linkedErrorsIntegration,
  makeFetchTransport,
} from '@sentry/nextjs'
import { env } from './lib/env'
import { isProd } from './lib/environment'

// Only in production
if (typeof window !== 'undefined' && isProd) {
  const client = new BrowserClient({
    dsn: env.NEXT_PUBLIC_SENTRY_DSN || undefined,
    environment: env.NODE_ENV || 'development',
    transport: makeFetchTransport,
    stackParser: defaultStackParser,
    integrations: [breadcrumbsIntegration(), dedupeIntegration(), linkedErrorsIntegration()],
    beforeSend(event) {
      if (event.request && typeof event.request === 'object') {
        ;(event.request as any).ip = null
      }
      return event
    },
  })

  getCurrentScope().setClient(client)
  client.init()
}

export const onRouterTransitionStart = isProd ? captureRouterTransitionStart : () => {}

if (typeof window !== 'undefined') {
  const TELEMETRY_STATUS_KEY = 'simstudio-telemetry-status'
  let telemetryEnabled = true

  try {
    if (env.NEXT_TELEMETRY_DISABLED === '1') {
      telemetryEnabled = false
    } else {
      const storedPreference = localStorage.getItem(TELEMETRY_STATUS_KEY)
      if (storedPreference) {
        const status = JSON.parse(storedPreference)
        telemetryEnabled = status.enabled
      }
    }
  } catch (_e) {
    telemetryEnabled = false
  }

  /**
   * Safe serialize function to ensure we don't include circular references or invalid data
   */
  function safeSerialize(obj: any): any {
    if (obj === null || obj === undefined) return null
    if (typeof obj !== 'object') return obj

    if (Array.isArray(obj)) {
      return obj.map((item) => safeSerialize(item))
    }

    const result: Record<string, any> = {}

    for (const key in obj) {
      if (key in obj) {
        const value = obj[key]
        if (
          value === undefined ||
          value === null ||
          typeof value === 'function' ||
          typeof value === 'symbol'
        ) {
          continue
        }

        try {
          result[key] = safeSerialize(value)
        } catch (_e) {
          try {
            result[key] = String(value)
          } catch (_e2) {}
        }
      }
    }

    return result
  }
  ;(window as any).__SIM_TELEMETRY_ENABLED = telemetryEnabled
  ;(window as any).__SIM_TRACK_EVENT = (eventName: string, properties?: any) => {
    if (!telemetryEnabled) return

    const safeProps = properties || {}

    const payload = {
      category: 'feature_usage',
      action: eventName || 'unknown_event',
      timestamp: Date.now(),
      ...safeSerialize(safeProps),
    }

    fetch('/api/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {
      // Silently fail if sending metrics fails
    })
  }

  if (telemetryEnabled) {
    performance.mark('sim-studio-init')

    let telemetryConfig
    try {
      telemetryConfig = (window as any).__SIM_STUDIO_TELEMETRY_CONFIG || {
        clientSide: { enabled: true },
      }
    } catch (_e) {
      telemetryConfig = { clientSide: { enabled: true } }
    }

    window.addEventListener('load', () => {
      performance.mark('sim-studio-loaded')
      performance.measure('page-load', 'sim-studio-init', 'sim-studio-loaded')

      if (typeof PerformanceObserver !== 'undefined') {
        const lcpObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries()

          entries.forEach((entry) => {
            const value =
              entry.entryType === 'largest-contentful-paint'
                ? (entry as any).startTime
                : (entry as any).value || 0

            // Ensure we have non-null values for all fields
            const metric = {
              name: entry.name || 'unknown',
              value: value || 0,
              entryType: entry.entryType || 'unknown',
            }

            if (telemetryEnabled && telemetryConfig?.clientSide?.enabled) {
              const safePayload = {
                category: 'performance',
                action: 'web_vital',
                label: metric.name,
                value: metric.value,
                entryType: metric.entryType,
                timestamp: Date.now(),
              }

              fetch('/api/telemetry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(safePayload),
              }).catch(() => {
                // Silently fail if sending metrics fails
              })
            }
          })

          lcpObserver.disconnect()
        })

        const clsObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries()
          let clsValue = 0

          entries.forEach((entry) => {
            clsValue += (entry as any).value || 0
          })

          if (telemetryEnabled && telemetryConfig?.clientSide?.enabled) {
            const safePayload = {
              category: 'performance',
              action: 'web_vital',
              label: 'CLS',
              value: clsValue || 0,
              entryType: 'layout-shift',
              timestamp: Date.now(),
            }

            fetch('/api/telemetry', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(safePayload),
            }).catch(() => {
              // Silently fail if sending metrics fails
            })
          }

          clsObserver.disconnect()
        })

        const fidObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries()

          entries.forEach((entry) => {
            const processingStart = (entry as any).processingStart || 0
            const startTime = (entry as any).startTime || 0

            const metric = {
              name: entry.name || 'unknown',
              value: processingStart - startTime,
              entryType: entry.entryType || 'unknown',
            }

            if (telemetryEnabled && telemetryConfig?.clientSide?.enabled) {
              const safePayload = {
                category: 'performance',
                action: 'web_vital',
                label: 'FID',
                value: metric.value,
                entryType: metric.entryType,
                timestamp: Date.now(),
              }

              fetch('/api/telemetry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(safePayload),
              }).catch(() => {
                // Silently fail if sending metrics fails
              })
            }
          })

          fidObserver.disconnect()
        })

        lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true })
        clsObserver.observe({ type: 'layout-shift', buffered: true })
        fidObserver.observe({ type: 'first-input', buffered: true })
      }
    })

    window.addEventListener('error', (event) => {
      if (telemetryEnabled && telemetryConfig?.clientSide?.enabled) {
        const errorDetails = {
          message: event.error?.message || 'Unknown error',
          stack: event.error?.stack?.split('\n')[0] || '',
          url: window.location.pathname,
          timestamp: Date.now(),
        }

        const safePayload = {
          category: 'error',
          action: 'client_error',
          label: errorDetails.message,
          stack: errorDetails.stack,
          url: errorDetails.url,
          timestamp: errorDetails.timestamp,
        }

        fetch('/api/telemetry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(safePayload),
        }).catch(() => {
          // Silently fail if sending error fails
        })
      }
    })
  }
}
