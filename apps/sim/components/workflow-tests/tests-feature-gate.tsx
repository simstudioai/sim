'use client'

import type { ReactNode } from 'react'
import { useFeatureFlag } from '@/lib/core/config/feature-flags-context'

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
