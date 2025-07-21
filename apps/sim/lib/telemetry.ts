/**
 * Sim Studio Telemetry
 *
 * This file can be customized in forked repositories:
 * - Set TELEMETRY_ENDPOINT in telemetry.config.ts to your collector
 * - Modify allowed event categories as needed
 * - Edit disclosure text to match your privacy policy
 *
 * Please maintain ethical telemetry practices if modified.
 */
import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api'
import { env } from '@/lib/env'
import { isProd } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console-logger'

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR)

const logger = createLogger('Telemetry')

export type TelemetryEvent = {
  name: string
  properties?: Record<string, any>
}

export type TelemetryStatus = {
  enabled: boolean
  notifiedUser: boolean
}

const TELEMETRY_STATUS_KEY = 'simstudio-telemetry-status'

let telemetryConfig = {
  endpoint: env.TELEMETRY_ENDPOINT || 'https://telemetry.simstudio.ai/v1/traces',
  serviceName: 'sim-studio',
  serviceVersion: '0.1.0',
}

if (typeof window !== 'undefined' && (window as any).__SIM_STUDIO_TELEMETRY_CONFIG) {
  telemetryConfig = { ...telemetryConfig, ...(window as any).__SIM_STUDIO_TELEMETRY_CONFIG }
}

let telemetryInitialized = false

/**
 * Gets the current telemetry status from localStorage
 */
export function getTelemetryStatus(): TelemetryStatus {
  if (typeof window === 'undefined') {
    return { enabled: true, notifiedUser: false }
  }

  try {
    if (env.NEXT_TELEMETRY_DISABLED === '1') {
      return { enabled: false, notifiedUser: true }
    }

    const stored = localStorage.getItem(TELEMETRY_STATUS_KEY)
    return stored ? JSON.parse(stored) : { enabled: true, notifiedUser: false }
  } catch (error) {
    logger.error('Failed to get telemetry status from localStorage', error)
    return { enabled: true, notifiedUser: false }
  }
}

/**
 * Sets the telemetry status in localStorage
 */
export function setTelemetryStatus(status: TelemetryStatus): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    localStorage.setItem(TELEMETRY_STATUS_KEY, JSON.stringify(status))

    if (status.enabled && !telemetryInitialized) {
      initializeClientTelemetry()
    }
  } catch (error) {
    logger.error('Failed to set telemetry status in localStorage', error)
  }
}

/**
 * Mark that the user has been notified about telemetry
 */
export function markUserNotified(): void {
  const status = getTelemetryStatus()
  setTelemetryStatus({ ...status, notifiedUser: true })
}

/**
 * Disables telemetry
 */
export function disableTelemetry(): void {
  const currentStatus = getTelemetryStatus()
  if (currentStatus.enabled) {
    trackEvent('consent', 'opt_out')
  }

  setTelemetryStatus({ enabled: false, notifiedUser: true })
  logger.info('Telemetry disabled')
}

/**
 * Enables telemetry
 */
export function enableTelemetry(): void {
  if (env.NEXT_TELEMETRY_DISABLED === '1') {
    logger.info('Telemetry disabled by environment variable, cannot enable')
    return
  }

  const currentStatus = getTelemetryStatus()
  if (!currentStatus.enabled) {
    trackEvent('consent', 'opt_in')
  }

  setTelemetryStatus({ enabled: true, notifiedUser: true })
  logger.info('Telemetry enabled')

  if (!telemetryInitialized) {
    initializeClientTelemetry()
  }
}

/**
 * Initialize client-side telemetry without OpenTelemetry SDK
 * This approach uses direct event tracking instead of the OTel SDK
 * to avoid TypeScript compatibility issues while still collecting useful data
 */
function initializeClientTelemetry(): void {
  if (typeof window === 'undefined' || telemetryInitialized) {
    return
  }

  try {
    const clientSideEnabled =
      (window as any).__SIM_STUDIO_TELEMETRY_CONFIG?.clientSide?.enabled !== false

    if (!clientSideEnabled) {
      logger.info('Client-side telemetry disabled in configuration')
      return
    }

    if (isProd) {
      trackEvent('page_view', window.location.pathname)

      if (typeof window.history !== 'undefined') {
        const originalPushState = window.history.pushState
        window.history.pushState = function (...args) {
          const result = originalPushState.apply(this, args)
          trackEvent('page_view', window.location.pathname)
          return result
        }
      }

      if (typeof window.performance !== 'undefined') {
        window.addEventListener('load', () => {
          setTimeout(() => {
            if (performance.getEntriesByType) {
              const navigationTiming = performance.getEntriesByType(
                'navigation'
              )[0] as PerformanceNavigationTiming
              if (navigationTiming) {
                trackEvent(
                  'performance',
                  'page_load',
                  window.location.pathname,
                  navigationTiming.loadEventEnd - navigationTiming.startTime
                )
              }

              const lcpEntries = performance
                .getEntriesByType('paint')
                .filter((entry) => entry.name === 'largest-contentful-paint')
              if (lcpEntries.length > 0) {
                trackEvent(
                  'performance',
                  'largest_contentful_paint',
                  window.location.pathname,
                  lcpEntries[0].startTime
                )
              }
            }
          }, 0)
        })
      }

      document.addEventListener(
        'click',
        (e) => {
          let target = e.target as HTMLElement | null
          let telemetryAction = null

          while (target && !telemetryAction) {
            telemetryAction = target.getAttribute('data-telemetry')
            if (!telemetryAction) {
              target = target.parentElement
            }
          }

          if (telemetryAction) {
            trackEvent('feature_usage', telemetryAction)
          }
        },
        { passive: true }
      )

      document.addEventListener(
        'submit',
        (e) => {
          const form = e.target as HTMLFormElement
          const telemetryAction = form.getAttribute('data-telemetry')
          if (telemetryAction) {
            trackEvent('feature_usage', telemetryAction)
          }
        },
        { passive: true }
      )

      window.addEventListener(
        'error',
        (event) => {
          const errorDetails = {
            message: event.error?.message || 'Unknown error',
            stack: event.error?.stack?.split('\n')[0] || '',
            url: window.location.pathname,
          }
          trackEvent('error', 'client_error', errorDetails.message)
        },
        { passive: true }
      )

      window.addEventListener(
        'unhandledrejection',
        (event) => {
          const errorDetails = {
            message: event.reason?.message || String(event.reason) || 'Unhandled promise rejection',
            url: window.location.pathname,
          }
          trackEvent('error', 'unhandled_rejection', errorDetails.message)
        },
        { passive: true }
      )

      logger.info('Enhanced client-side telemetry initialized')
      telemetryInitialized = true
    }
  } catch (error) {
    logger.error('Failed to initialize client-side telemetry', error)
  }
}

/**
 * Track a telemetry event
 */
export async function trackEvent(
  category: string,
  action: string,
  label?: string,
  value?: number
): Promise<void> {
  const status = getTelemetryStatus()

  if (!status.enabled) return

  try {
    if (isProd) {
      await fetch('/api/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          action,
          label,
          value,
          timestamp: new Date().toISOString(),
          service: telemetryConfig.serviceName,
          version: telemetryConfig.serviceVersion,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
          url: typeof window !== 'undefined' ? window.location.pathname : undefined,
        }),
      })
    } else {
      if (category === 'consent') {
        logger.debug('Telemetry consent change', { action })
      }
    }
  } catch (error) {
    logger.error('Failed to track telemetry event', error)
  }
}
