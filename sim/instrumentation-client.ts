/**
 * Sim Studio Telemetry - Client-side Instrumentation
 * 
 * This file initializes client-side telemetry when the app loads in the browser.
 * It respects the user's telemetry preferences stored in localStorage.
 * 
 */

if (typeof window !== 'undefined') {
  const TELEMETRY_STATUS_KEY = 'simstudio-telemetry-status'
  let telemetryEnabled = true

  try {
    if (process.env.NEXT_TELEMETRY_DISABLED === '1') {
      telemetryEnabled = false
    } else {
      const storedPreference = localStorage.getItem(TELEMETRY_STATUS_KEY)
      if (storedPreference) {
        const status = JSON.parse(storedPreference)
        telemetryEnabled = status.enabled
      }
    }
  } catch (e) {
    telemetryEnabled = true
  }

  if (telemetryEnabled) {
    performance.mark('sim-studio-init')

    let telemetryConfig
    try {
      telemetryConfig = (window as any).__SIM_STUDIO_TELEMETRY_CONFIG || {
        clientSide: { enabled: true },
      }
    } catch (e) {
      telemetryConfig = { clientSide: { enabled: true } }
    }

    window.addEventListener('load', () => {
      performance.mark('sim-studio-loaded')
      performance.measure('page-load', 'sim-studio-init', 'sim-studio-loaded')
      
      if ('web-vital' in performance) {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const metric = {
              name: entry.name,
              value: entry.startTime,
              rating: entry.entryType,
            }
            
            if (telemetryEnabled && telemetryConfig?.clientSide?.enabled) {
              fetch('/api/telemetry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  category: 'performance',
                  action: 'web_vital',
                  label: metric.name,
                  value: metric.value,
                  rating: metric.rating,
                }),
              }).catch(() => {
                // Silently fail if sending metrics fails
              })
            }
          }
        })
        
        observer.observe({ type: 'layout-shift', buffered: true })
        observer.observe({ type: 'largest-contentful-paint', buffered: true })
        observer.observe({ type: 'first-input', buffered: true })
      }
    })

    window.addEventListener('error', (event) => {
      if (telemetryEnabled && telemetryConfig?.clientSide?.enabled) {
        const errorDetails = {
          message: event.error?.message || 'Unknown error',
          stack: event.error?.stack?.split('\n')[0] || '',
          url: window.location.pathname,
        }
        
        // Send anonymized error to telemetry API
        fetch('/api/telemetry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: 'error',
            action: 'client_error',
            label: errorDetails.message,
            stack: errorDetails.stack,
            url: errorDetails.url,
          }),
        }).catch(() => {
          // Silently fail if sending error fails
        })
      }
    })
  }
} 