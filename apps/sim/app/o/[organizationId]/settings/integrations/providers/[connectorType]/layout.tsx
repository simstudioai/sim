import type { ReactNode } from 'react'
import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'

interface OrganizationProviderLayoutProps {
  children: ReactNode
}

export default function OrganizationProviderLayout({ children }: OrganizationProviderLayoutProps) {
  return (
    <SettingsHeaderProvider>
      <SettingsHeaderShell meta={{ title: 'Integration' }}>{children}</SettingsHeaderShell>
    </SettingsHeaderProvider>
  )
}
