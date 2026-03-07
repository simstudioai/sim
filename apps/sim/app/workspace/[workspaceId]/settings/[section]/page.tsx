'use client'

import { useParams } from 'next/navigation'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'
import { SettingsPage } from './settings'

export default function SettingsSectionPage() {
  const params = useParams()
  const section = params.section as SettingsSection

  return <SettingsPage section={section} />
}
