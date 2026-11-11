import { notFound } from 'next/navigation'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import { MothershipPanel } from '@/app/(product)/o/[organizationId]/settings/_components/sections/mothership/mothership-panel'

export default function MothershipSection({ organization }: SettingsSectionProps) {
  if (!organization.navFlags.platformAdmin) notFound()
  return (
    <>
      <SettingsPageHeader />
      <MothershipPanel referenceTime={Date.now()} />
    </>
  )
}
