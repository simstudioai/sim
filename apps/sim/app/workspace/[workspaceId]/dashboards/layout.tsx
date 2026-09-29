import type { ReactNode } from 'react'
import { DashboardFeatureGate } from '@/components/dashboards/dashboard-feature-gate'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardFeatureGate>{children}</DashboardFeatureGate>
}
