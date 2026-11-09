import { HydrationBoundary } from '@tanstack/react-query'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import { MembersPanel } from '@/platform/app/(shell)/settings/_components/sections/members/members-panel'

export default async function MembersSection({ organization, fixture }: SettingsSectionProps) {
  if (fixture) return <MembersPanel organization={organization} />
  const { prefetchRoster } = await import('@/platform/lib/data/prefetch-roster')
  const state = await prefetchRoster(organization.organization.id)
  return (
    <HydrationBoundary state={state}>
      <MembersPanel organization={organization} />
    </HydrationBoundary>
  )
}
