import type { ReactNode } from 'react'
import { ChangelogFeatureGate } from '@/app/workspace/[workspaceId]/changelog/components'

interface ChangelogLayoutProps {
  children: ReactNode
}

export default function ChangelogLayout({ children }: ChangelogLayoutProps) {
  return <ChangelogFeatureGate>{children}</ChangelogFeatureGate>
}
