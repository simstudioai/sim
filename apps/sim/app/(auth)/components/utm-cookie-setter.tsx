'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const
const COOKIE_NAME = 'sim_utm'
const COOKIE_MAX_AGE = 3600 // 1 hour

export function UtmCookieSetter() {
  const searchParams = useSearchParams()

  useEffect(() => {
    const hasUtm = UTM_KEYS.some((key) => searchParams.get(key))
    if (!hasUtm) return

    const utmData: Record<string, string> = {}
    for (const key of UTM_KEYS) {
      const value = searchParams.get(key)
      if (value) {
        utmData[key] = value
      }
    }

    utmData.referrer_url = document.referrer || ''
    utmData.landing_page = window.location.pathname
    utmData.created_at = Date.now().toString()

    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(utmData))}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
  }, [searchParams])

  return null
}
