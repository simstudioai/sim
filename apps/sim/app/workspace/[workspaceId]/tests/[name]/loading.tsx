'use client'

import { ShieldCheck } from '@sim/emcn/icons'
import { ResourceChromeFallback } from '@/app/workspace/[workspaceId]/components/resource/components/resource-chrome-fallback'
import type { BreadcrumbItem } from '@/app/workspace/[workspaceId]/components/resource/components/resource-header'

const BREADCRUMBS: BreadcrumbItem[] = [
  { label: 'Tests', icon: ShieldCheck },
  { label: '…', terminal: true },
]

export default function TestLoading() {
  return <ResourceChromeFallback icon={ShieldCheck} breadcrumbs={BREADCRUMBS} />
}
