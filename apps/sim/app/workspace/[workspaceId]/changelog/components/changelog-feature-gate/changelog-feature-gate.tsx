'use client'

import type { ReactNode } from 'react'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'

interface ChangelogFeatureGateProps {
  children: ReactNode
}

export function ChangelogFeatureGate({ children }: ChangelogFeatureGateProps) {
  const enabled = useFeatureFlag('changelog')
  return enabled ? (
    children
  ) : (
    <div role='alert' className='p-6 text-[var(--text-muted)]'>
      The changelog is not enabled
    </div>
  )
}
