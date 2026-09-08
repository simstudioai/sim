import { getErrorMessage } from '@sim/utils/errors'
import { randomFloat } from '@sim/utils/random'
import type { TelemetryEvent } from '@/lib/api/contracts/telemetry'
import {
  getStoredMeasurementPermission,
  subscribeStoredMeasurementPermission,
} from '@/lib/consent/measurement-permission'
import { sanitizeEventData } from '@/lib/core/security/redaction'
import {
  getBrowserTelemetryPreference,
  subscribeBrowserTelemetryPreference,
} from '@/lib/telemetry/browser-preference'

const BATCH_INTERVAL_MS = 10_000
const MAX_BATCH_SIZE = 50
const MAX_PAYLOAD_BYTES = 64 * 1024

/** Starts optional browser diagnostics. Cleanup discards pending data instead of sending it. */
export function startBrowserTelemetry(consentRequired: boolean): () => void {
  const isAllowed = () =>
    getBrowserTelemetryPreference() && (!consentRequired || getStoredMeasurementPermission())
  if (!isAllowed()) return () => {}

  let active = true
  let cls = 0
  let batchTimer: ReturnType<typeof setTimeout> | undefined
  const events: TelemetryEvent[] = []
  const observers: PerformanceObserver[] = []
  const requests = new AbortController()

  function flush(): void {
    if (!active || !isAllowed() || events.length === 0) return
    clearTimeout(batchTimer)
    batchTimer = undefined

    const payload = JSON.stringify({
      category: 'batch',
      action: 'client_events',
      events: events.splice(0).map(sanitizeEventData),
      timestamp: Date.now(),
    })
    if (new Blob([payload]).size >= MAX_PAYLOAD_BYTES) return

    /** Page-exit diagnostics must survive navigation; requestJson does not support keepalive. */
    // boundary-raw-fetch: page-exit diagnostics require keepalive and must not add a persistent client identifier
    void fetch('/api/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
      signal: requests.signal,
    }).catch(() => {})
  }

  function add(event: TelemetryEvent): void {
    if (!active || !isAllowed()) return
    events.push(event)
    if (events.length >= MAX_BATCH_SIZE) flush()
    else batchTimer ??= setTimeout(flush, BATCH_INTERVAL_MS)
  }

  function recordVital(label: string, value: number, entryType: string): void {
    add({
      category: 'performance',
      action: 'web_vital',
      label,
      value,
      entryType,
      timestamp: Date.now(),
    })
  }

  const onError = (event: ErrorEvent) => {
    if (event.defaultPrevented) return
    add({
      category: 'error',
      action: 'unhandled_error',
      message: getErrorMessage(event.error, event.message || 'Unknown error'),
      url: window.location.pathname,
      timestamp: Date.now(),
    })
  }
  const onRejection = (event: PromiseRejectionEvent) => {
    if (event.defaultPrevented) return
    add({
      category: 'error',
      action: 'unhandled_rejection',
      message: getErrorMessage(event.reason, 'Unhandled promise rejection'),
      url: window.location.pathname,
      timestamp: Date.now(),
    })
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') flush()
  }
  const onPageHide = () => {
    if (cls > 0) recordVital('CLS', cls, 'layout-shift')
    cls = 0
    flush()
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  window.addEventListener('pagehide', onPageHide)
  document.addEventListener('visibilitychange', onVisibilityChange)

  if (randomFloat() < 0.1 && typeof PerformanceObserver !== 'undefined') {
    const observe = (type: string, onEntries: PerformanceObserverCallback) => {
      if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return
      const observer = new PerformanceObserver((list, current) => {
        if (active && isAllowed()) onEntries(list, current)
      })
      try {
        /** Do not replay performance entries recorded before permission was granted. */
        observer.observe({ type, buffered: false })
        observers.push(observer)
      } catch {
        observer.disconnect()
      }
    }
    observe('largest-contentful-paint', (list, observer) => {
      const entry = list.getEntries().at(-1)
      if (entry) recordVital('LCP', entry.startTime, 'largest-contentful-paint')
      observer.disconnect()
    })
    observe('layout-shift', (list) => {
      for (const entry of list.getEntries()) {
        if ('hadRecentInput' in entry && !entry.hadRecentInput && 'value' in entry) {
          cls += Number(entry.value) || 0
        }
      }
    })
    observe('first-input', (list, observer) => {
      for (const entry of list.getEntries()) {
        const value =
          'processingStart' in entry ? Number(entry.processingStart) - entry.startTime : 0
        recordVital('FID', value, 'first-input')
      }
      observer.disconnect()
    })
  }

  const unsubscribe = subscribeBrowserTelemetryPreference(() => {
    if (!getBrowserTelemetryPreference()) stop()
  })
  const unsubscribeConsent = subscribeStoredMeasurementPermission(() => {
    if (consentRequired && !getStoredMeasurementPermission()) stop()
  })

  function stop(): void {
    if (!active) return
    active = false
    cls = 0
    clearTimeout(batchTimer)
    events.length = 0
    requests.abort()
    for (const observer of observers) observer.disconnect()
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    window.removeEventListener('pagehide', onPageHide)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    unsubscribe()
    unsubscribeConsent()
  }

  return stop
}
