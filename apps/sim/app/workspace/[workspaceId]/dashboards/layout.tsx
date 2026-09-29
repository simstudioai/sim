import type { ReactNode } from 'react'
import { DashboardFeatureGate } from '@/components/dashboards/dashboard-feature-gate'

interface DashboardLayoutProps {
  children: ReactNode
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  return <DashboardFeatureGate>{children}</DashboardFeatureGate>
}
