'use client'

import { Link } from '@sim/emcn/icons'
import { ResourceChromeFallback } from '@/app/workspace/[workspaceId]/components/resource/components/resource-chrome-fallback'

export default function SimLinksLoading() {
  return <ResourceChromeFallback icon={Link} title='Sim Links' />
}
