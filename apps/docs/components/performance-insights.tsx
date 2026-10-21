'use client'

import type { ComponentProps } from 'react'
import { SpeedInsights } from '@vercel/speed-insights/next'

const redactUrl: ComponentProps<typeof SpeedInsights>['beforeSend'] = (event) => {
  try {
    const url = new URL(event.url)
    if (url.hostname !== 'docs.sim.ai') return null
    url.search = ''
    url.hash = ''
    return { ...event, url: url.toString() }
  } catch {
    return null
  }
}

/** Sample public production pages without collecting search terms or API playground parameters. */
export function PerformanceInsights() {
  return <SpeedInsights sampleRate={0.05} beforeSend={redactUrl} debug={false} />
}
