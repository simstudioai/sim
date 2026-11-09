'use client'

import { ShieldCheck } from '@sim/emcn-legacy/icons'
import { ResourceChromeFallback } from '@/components/resource/components/resource-chrome-fallback'

export default function TestsLoading() {
  return <ResourceChromeFallback icon={ShieldCheck} title='Tests' />
}
