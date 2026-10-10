'use client'

import type { ReactNode } from 'react'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'

interface TestsFeatureGateProps {
  children: ReactNode
}

export function TestsFeatureGate({ children }: TestsFeatureGateProps) {
  const enabled = useFeatureFlag('workflow-tests')
  return enabled ? (
    children
  ) : (
    <div role='alert' className='p-6 text-[var(--text-muted)]'>
      Tests are not enabled
    </div>
  )
}
