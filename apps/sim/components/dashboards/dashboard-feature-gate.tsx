'use client'

import type { ReactNode } from 'react'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'

export function DashboardFeatureGate({ children }: { children: ReactNode }) {
  const enabled = useFeatureFlag('dashboards')
  return enabled ? (
    children
  ) : (
    <div role='alert' className='p-6 text-[var(--text-secondary)]'>
      Dashboards are not enabled
    </div>
  )
}
