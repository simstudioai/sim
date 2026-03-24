'use client'

import { useEffect } from 'react'
import { env } from '@/lib/core/config/env'

export function OneDollarStats() {
  useEffect(() => {
    const shouldInitialize = !!env.DRIZZLE_ODS_API_KEY

    if (!shouldInitialize) {
      return
    }

    import('onedollarstats')
      .then(({ configure }) => {
        configure({
          collectorUrl: 'https://collector.onedollarstats.com/events',
          autocollect: true,
          hashRouting: true,
        })
      })
      .catch(() => {})
  }, [])

  return null
}
