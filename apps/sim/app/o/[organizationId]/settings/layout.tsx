import type { ReactNode } from 'react'
import { SettingsFrame } from '@/app/o/[organizationId]/settings/settings-frame'

interface OrganizationSettingsLayoutProps {
  children: ReactNode
}

export default function OrganizationSettingsLayout({ children }: OrganizationSettingsLayoutProps) {
  return <SettingsFrame>{children}</SettingsFrame>
}
