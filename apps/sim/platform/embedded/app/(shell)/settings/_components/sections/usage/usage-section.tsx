'use client'

import type { SettingsSectionProps } from '@/platform/embedded/app/(shell)/settings/_components/section-registry'
import { UsageEvents } from '@/platform/embedded/app/(shell)/settings/_components/sections/usage/usage-events'
import { UsageMonitoring } from '@/platform/embedded/app/(shell)/settings/_components/sections/usage/usage-monitoring'

export default function UsageSection({ organization, subpath }: SettingsSectionProps) {
  return subpath[0] === 'events' ? (
    <UsageEvents organizationId={organization.organization.id} />
  ) : (
    <UsageMonitoring organization={organization} />
  )
}
