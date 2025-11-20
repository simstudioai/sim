'use client'

import { useEffect } from 'react'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('RootLayout')

const BROWSER_EXTENSION_ATTRIBUTES = [
  'data-new-gr-c-s-check-loaded',
  'data-gr-ext-installed',
  'data-gr-ext-disabled',
  'data-grammarly',
  'data-fgm',
  'data-lt-installed',
]

/**
 * Client component that intercepts console.error to filter and log hydration errors
 * while ignoring errors caused by browser extensions.
 */
export function HydrationErrorHandler() {
  useEffect(() => {
    const originalError = console.error
    console.error = (...args) => {
      if (args[0].includes('Hydration')) {
        const isExtensionError = BROWSER_EXTENSION_ATTRIBUTES.some((attr) =>
          args.some((arg) => typeof arg === 'string' && arg.includes(attr))
        )

        if (!isExtensionError) {
          logger.error('Hydration Error', {
            details: args,
            componentStack: args.find(
              (arg) => typeof arg === 'string' && arg.includes('component stack')
            ),
          })
        }
      }
      originalError.apply(console, args)
    }

    return () => {
      console.error = originalError
    }
  }, [])

  return null
}
