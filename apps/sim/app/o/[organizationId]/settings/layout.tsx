'use client'

import type { ReactNode } from 'react'
import { SettingsPendingSection } from '@/components/settings/settings-pending-section'
import { useSettingsBeforeUnload } from '@/components/settings/use-settings-before-unload'
import { resolveOrganizationSurfaceHeaderMeta } from '@/app/o/[organizationId]/settings/navigation'

interface OrganizationSettingsLayoutProps {
  children: ReactNode
}

export default function OrganizationSettingsLayout({ children }: OrganizationSettingsLayoutProps) {
  useSettingsBeforeUnload()
  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <SettingsPendingSection resolveMeta={resolveOrganizationSurfaceHeaderMeta}>
        {children}
      </SettingsPendingSection>
    </div>
  )
}
