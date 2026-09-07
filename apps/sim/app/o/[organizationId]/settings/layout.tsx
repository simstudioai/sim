'use client'

import type { ReactNode } from 'react'
import { useSettingsBeforeUnload } from '@/components/settings/use-settings-before-unload'

interface OrganizationSettingsLayoutProps {
  children: ReactNode
}

export default function OrganizationSettingsLayout({ children }: OrganizationSettingsLayoutProps) {
  useSettingsBeforeUnload()
  return <div className='flex h-full flex-col bg-[var(--bg)]'>{children}</div>
}
