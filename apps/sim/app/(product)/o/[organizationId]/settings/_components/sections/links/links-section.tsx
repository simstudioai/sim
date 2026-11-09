import { HydrationBoundary } from '@tanstack/react-query'
import { LinksPage } from '@/app/(product)/_components/links-page/links-page'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'

/** The zone serves Links under Settings; the page is the one the organization surface embeds. */
export default async function LinksSection({ organization, query, fixture }: SettingsSectionProps) {
  const organizationId = organization.organization.id
  if (fixture) return <LinksPage organizationId={organizationId} />
  const { prefetchSimLinks } = await import('@/platform/lib/data/prefetch-sim-links')
  return (
    <HydrationBoundary state={await prefetchSimLinks(organizationId, query)}>
      <LinksPage organizationId={organizationId} />
    </HydrationBoundary>
  )
}
