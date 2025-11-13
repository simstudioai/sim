'use client'

import { useEffect } from 'react'
import { configure } from 'onedollarstats'
import { env } from '@/lib/env'

export function OneDollarStats() {
  useEffect(() => {
    const shouldInitialize = !!env.DRIZZLE_ODS_API_KEY

    if (!shouldInitialize) {
      return
    }

    configure({
      collectorUrl: 'https://collector.onedollarstats.com/events',
      autocollect: true,
      hashRouting: true,
    })
  }, [])

  return null
}
