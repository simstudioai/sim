'use client'

import { useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { platformHref } from '@/platform/lib/navigation'

function useFixtureHref() {
  const search = useSearchParams()
  return useCallback((path: string) => platformHref(path, search), [search])
}

const keepPath = (path: string) => path

function useLiveHref() {
  return keepPath
}

/**
 * {@link platformHref} bound to the current URL. The choice is made when the app is built: only a
 * fixture build reads the query string, so a live build subscribes to no query-string change.
 */
export const usePlatformHref: () => (path: string) => string =
  process.env.SIM_PLATFORM_FIXTURES === '1' ? useFixtureHref : useLiveHref
