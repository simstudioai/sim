import type { ReactNode } from 'react'
import { TestsFeatureGate } from '@/components/workflow-tests'

interface TestsLayoutProps {
  children: ReactNode
}

export default function TestsLayout({ children }: TestsLayoutProps) {
  return <TestsFeatureGate>{children}</TestsFeatureGate>
}
