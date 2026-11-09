'use client'

import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import { UsageEvents } from '@/app/(product)/o/[organizationId]/settings/_components/sections/usage/usage-events'
import { UsageMonitoring } from '@/app/(product)/o/[organizationId]/settings/_components/sections/usage/usage-monitoring'

export default function UsageSection({ organization, subpath }: SettingsSectionProps) {
  return subpath[0] === 'events' ? (
    <UsageEvents organizationId={organization.organization.id} />
  ) : (
    <UsageMonitoring organization={organization} />
  )
}
