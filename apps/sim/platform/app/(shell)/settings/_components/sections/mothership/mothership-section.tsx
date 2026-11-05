import { notFound } from 'next/navigation'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import { MothershipPanel } from '@/platform/app/(shell)/settings/_components/sections/mothership/mothership-panel'

export default function MothershipSection({ organization }: SettingsSectionProps) {
  if (!organization.navFlags.platformAdmin) notFound()
  return <MothershipPanel organization={organization} referenceTime={Date.now()} />
}
