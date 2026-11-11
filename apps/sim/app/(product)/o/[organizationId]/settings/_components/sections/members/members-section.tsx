import { HydrationBoundary } from '@tanstack/react-query'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import { MembersPanel } from '@/app/(product)/o/[organizationId]/settings/_components/sections/members/members-panel'

export default async function MembersSection({ organization, fixture }: SettingsSectionProps) {
  if (fixture)
    return (
      <>
        <SettingsPageHeader />
        <MembersPanel organization={organization} />
      </>
    )
  const { prefetchRoster } = await import('@/platform/lib/data/prefetch-roster')
  const state = await prefetchRoster(organization.organization.id)
  return (
    <>
      <SettingsPageHeader />
      <HydrationBoundary state={state}>
        <MembersPanel organization={organization} />
      </HydrationBoundary>
    </>
  )
}
