/**
 * Sim Telemetry - Client-side Instrumentation
 */

import { env } from './lib/env'

if (typeof window !== 'undefined') {
  const TELEMETRY_STATUS_KEY = 'simstudio-telemetry-status'
  const BATCH_INTERVAL_MS = 10000 // Send batches every 10 seconds
  const MAX_BATCH_SIZE = 50 // Max events per batch
  let telemetryEnabled = true
  const eventBatch: any[] = []
  let batchTimer: NodeJS.Timeout | null = null

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
   * Add event to batch and schedule flush
   */
  function addToBatch(event: any): void {
    if (!telemetryEnabled) return

    eventBatch.push(event)

    if (eventBatch.length >= MAX_BATCH_SIZE) {
      flushBatch()
    } else if (!batchTimer) {
      batchTimer = setTimeout(flushBatch, BATCH_INTERVAL_MS)
    }
  }

  /**
   * Sanitize event data to remove sensitive information
   */
  function sanitizeEvent(event: any): any {
    const patterns = ['password', 'token', 'secret', 'key', 'auth', 'credential', 'private']
    const sensitiveRe = new RegExp(patterns.join('|'), 'i')

    const scrubString = (s: string) => (s && sensitiveRe.test(s) ? '[redacted]' : s)

    if (event == null) return event
    if (typeof event === 'string') return scrubString(event)
    if (typeof event !== 'object') return event

    if (Array.isArray(event)) {
      return event.map((item) => sanitizeEvent(item))
    }

    const sanitized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(event)) {
      const lowerKey = key.toLowerCase()
      if (patterns.some((p) => lowerKey.includes(p))) continue

      if (typeof value === 'string') sanitized[key] = scrubString(value)
      else if (Array.isArray(value)) sanitized[key] = value.map((v) => sanitizeEvent(v))
      else if (value && typeof value === 'object') sanitized[key] = sanitizeEvent(value)
      else sanitized[key] = value
    }

    return sanitized
  }

  /**
   * Flush batch of events to server
   */
  function flushBatch(): void {
    if (eventBatch.length === 0) return

    const batch = eventBatch.splice(0, eventBatch.length)
    if (batchTimer) {
      clearTimeout(batchTimer)
      batchTimer = null
    }

    const sanitizedBatch = batch.map(sanitizeEvent)

    const payload = JSON.stringify({
      category: 'batch',
      action: 'client_events',
      events: sanitizedBatch,
      timestamp: Date.now(),
    })

    const payloadSize = new Blob([payload]).size
    const MAX_BEACON_SIZE = 64 * 1024 // 64KB

    if (navigator.sendBeacon && payloadSize < MAX_BEACON_SIZE) {
      const sent = navigator.sendBeacon('/api/telemetry', payload)

      if (!sent) {
        fetch('/api/telemetry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(() => {
          // Silently fail
        })
      }
    } else {
      fetch('/api/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {
        // Silently fail
      })
    }
  }

  window.addEventListener('beforeunload', flushBatch)
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushBatch()
    }
  })

  /**
   * Global event tracking function
   */

  ;(window as any).__SIM_TELEMETRY_ENABLED = telemetryEnabled
  ;(window as any).__SIM_TRACK_EVENT = (eventName: string, properties?: any) => {
    if (!telemetryEnabled) return

    addToBatch({
      category: 'feature_usage',
      action: eventName,
      timestamp: Date.now(),
      ...(properties || {}),
    })
  }

  if (telemetryEnabled) {
    const shouldTrackVitals = Math.random() < 0.1

    if (shouldTrackVitals) {
      window.addEventListener(
        'load',
        () => {
          if (typeof PerformanceObserver !== 'undefined') {
            const lcpObserver = new PerformanceObserver((list) => {
              const entries = list.getEntries()
              const lastEntry = entries[entries.length - 1]

              if (lastEntry) {
                addToBatch({
                  category: 'performance',
                  action: 'web_vital',
                  label: 'LCP',
                  value: (lastEntry as any).startTime || 0,
                  entryType: 'largest-contentful-paint',
                  timestamp: Date.now(),
                })
              }

              lcpObserver.disconnect()
            })

            let clsValue = 0
            const clsObserver = new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                if (!(entry as any).hadRecentInput) {
                  clsValue += (entry as any).value || 0
                }
              }
            })

            const fidObserver = new PerformanceObserver((list) => {
              const entries = list.getEntries()

              for (const entry of entries) {
                const fidValue =
                  ((entry as any).processingStart || 0) - ((entry as any).startTime || 0)

                addToBatch({
                  category: 'performance',
                  action: 'web_vital',
                  label: 'FID',
                  value: fidValue,
                  entryType: 'first-input',
                  timestamp: Date.now(),
                })
              }

              fidObserver.disconnect()
            })

            window.addEventListener('beforeunload', () => {
              if (clsValue > 0) {
                addToBatch({
                  category: 'performance',
                  action: 'web_vital',
                  label: 'CLS',
                  value: clsValue,
                  entryType: 'layout-shift',
                  timestamp: Date.now(),
                })
              }
              clsObserver.disconnect()
            })

            lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true })
            clsObserver.observe({ type: 'layout-shift', buffered: true })
            fidObserver.observe({ type: 'first-input', buffered: true })
          }
        },
        { once: true }
      )
    }

    window.addEventListener('error', (event) => {
      if (telemetryEnabled && !event.defaultPrevented) {
        addToBatch({
          category: 'error',
          action: 'unhandled_error',
          message: event.error?.message || event.message || 'Unknown error',
          url: window.location.pathname,
          timestamp: Date.now(),
        })
      }
    })

    window.addEventListener('unhandledrejection', (event) => {
      if (telemetryEnabled) {
        addToBatch({
          category: 'error',
          action: 'unhandled_rejection',
          message: event.reason?.message || String(event.reason) || 'Unhandled promise rejection',
          url: window.location.pathname,
          timestamp: Date.now(),
        })
      }
    })
  }
}
