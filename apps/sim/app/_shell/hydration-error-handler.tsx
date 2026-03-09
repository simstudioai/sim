'use client'

import { useEffect } from 'react'
import { createLogger } from '@sim/logger'

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
 * Checks whether a hydration error is caused by Radix UI's auto-generated IDs
 * (`aria-controls`, `id`) differing between server and client. This is a known
 * harmless artifact of React 19's streaming SSR producing different `useId()`
 * tree paths. The IDs self-correct on first interaction and have no visual or
 * functional impact since they only link closed (invisible) popover/menu content.
 */
function isRadixIdMismatch(args: unknown[]): boolean {
  return args.some(
    (arg) => typeof arg === 'string' && arg.includes('radix-') && /aria-controls|"\bid\b"/.test(arg)
  )
}

/**
 * Client component that intercepts console.error to filter hydration errors
 * caused by browser extensions or Radix UI's `useId()` mismatch.
 */
export function HydrationErrorHandler() {
  useEffect(() => {
    const originalError = console.error
    console.error = (...args) => {
      if (typeof args[0] === 'string' && args[0].includes('Hydration')) {
        const isExtensionError = BROWSER_EXTENSION_ATTRIBUTES.some((attr) =>
          args.some((arg) => typeof arg === 'string' && arg.includes(attr))
        )

        if (isExtensionError || isRadixIdMismatch(args)) {
          return
        }

        logger.error('Hydration Error', {
          details: args,
          componentStack: args.find(
            (arg) => typeof arg === 'string' && arg.includes('component stack')
          ),
        })
      }
      originalError.apply(console, args)
    }

    return () => {
      console.error = originalError
    }
  }, [])

  return null
}
