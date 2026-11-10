'use client'

import { useEffect, useState } from 'react'
import { useHydrated } from '@/hooks/use-hydrated'
import { MINUTE_MS } from '@/platform/shared/time'

/**
 * One reference instant for a surface's ages, moving on by the minute. `null` in server HTML and
 * during hydration, where the viewer's clock is unknown, so the two renders agree; an age formatted
 * against `null` paints nothing until the client knows the time.
 */
export function useMinuteClock(): number | null {
  const hydrated = useHydrated()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE_MS)
    return () => clearInterval(timer)
  }, [])
  return hydrated ? now : null
}
