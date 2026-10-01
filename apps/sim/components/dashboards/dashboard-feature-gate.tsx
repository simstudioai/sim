'use client'

import type { ReactNode } from 'react'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'

interface DashboardFeatureGateProps {
  children: ReactNode
}

export function DashboardFeatureGate({ children }: DashboardFeatureGateProps) {
  const enabled = useFeatureFlag('dashboards')
  return enabled ? (
    children
  ) : (
    <div role='alert' className='p-6 text-[var(--text-muted)]'>
      Dashboards are not enabled
    </div>
  )
}
