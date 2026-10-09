import type { ReactNode } from 'react'
import { TestsFeatureGate } from '@/app/workspace/[workspaceId]/tests/components'

interface TestsLayoutProps {
  children: ReactNode
}

export default function TestsLayout({ children }: TestsLayoutProps) {
  return <TestsFeatureGate>{children}</TestsFeatureGate>
}
