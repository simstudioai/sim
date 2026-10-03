import type { ReactNode } from 'react'
import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'

interface OrganizationSourceLayoutProps {
  children: ReactNode
}

export default function OrganizationSourceLayout({ children }: OrganizationSourceLayoutProps) {
  return (
    <SettingsHeaderProvider>
      <SettingsHeaderShell meta={{ title: 'Search source' }}>{children}</SettingsHeaderShell>
    </SettingsHeaderProvider>
  )
}
