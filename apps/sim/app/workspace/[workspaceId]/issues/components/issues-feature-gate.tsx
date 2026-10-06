'use client'

import type { ReactNode } from 'react'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'

interface IssuesFeatureGateProps {
  children: ReactNode
}

export function IssuesFeatureGate({ children }: IssuesFeatureGateProps) {
  const enabled = useFeatureFlag('issues')
  return enabled ? (
    children
  ) : (
    <div role='alert' className='p-6 text-[var(--text-muted)]'>
      Issues are not enabled
    </div>
  )
}
