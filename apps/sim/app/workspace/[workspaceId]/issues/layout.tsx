import type { ReactNode } from 'react'
import { IssuesFeatureGate } from '@/app/workspace/[workspaceId]/issues/components'

interface IssuesLayoutProps {
  children: ReactNode
}

export default function IssuesLayout({ children }: IssuesLayoutProps) {
  return <IssuesFeatureGate>{children}</IssuesFeatureGate>
}
