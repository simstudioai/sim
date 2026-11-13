'use client'

import { useEffect } from 'react'

/**
 * Cookies a removed integration may have left in returning browsers. Nothing
 * reads them any more, so they are deleted whatever the visitor's consent:
 * keeping an unused advertising identifier serves no one. `bfcid` lives at most
 * 30 days, so this list can be emptied once that window has passed.
 */
const RETIRED_COOKIES = ['bfcid'] as const

/** Deletes every retired cookie present in this browser, once per page load. */
export function RetiredCookieCleanup() {
  useEffect(() => {
    for (const name of RETIRED_COOKIES) {
      if (document.cookie.includes(`${name}=`)) {
        document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`
      }
    }
  }, [])

  return null
}
