'use client'

import { Rss } from '@sim/emcn-legacy/icons'
import { ResourceChromeFallback } from '@/components/resource/components/resource-chrome-fallback'

export default function ChangelogLoading() {
  return <ResourceChromeFallback icon={Rss} title='Changelog' />
}
