'use client'

import { ShieldCheck } from '@sim/emcn/icons'
import { ResourceChromeFallback } from '@/app/workspace/[workspaceId]/components/resource/components/resource-chrome-fallback'

export default function TestsLoading() {
  return <ResourceChromeFallback icon={ShieldCheck} title='Tests' />
}
