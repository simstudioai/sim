'use client'

import { Rss } from '@sim/emcn/icons'
import { ResourceChromeFallback } from '@/app/workspace/[workspaceId]/components/resource/components/resource-chrome-fallback'

export default function ChangelogLoading() {
  return <ResourceChromeFallback icon={Rss} title='Changelog' />
}
