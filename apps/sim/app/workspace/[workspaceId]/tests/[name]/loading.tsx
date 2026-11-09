'use client'

import { ShieldCheck } from '@sim/emcn-legacy/icons'
import { ResourceChromeFallback } from '@/components/resource/components/resource-chrome-fallback'
import type { BreadcrumbItem } from '@/components/resource/components/resource-header'

const BREADCRUMBS: BreadcrumbItem[] = [
  { label: 'Tests', icon: ShieldCheck },
  { label: '…', terminal: true },
]

export default function TestLoading() {
  return <ResourceChromeFallback icon={ShieldCheck} breadcrumbs={BREADCRUMBS} />
}
