import type { Metadata } from 'next'
import type { SearchParams } from 'nuqs/server'
import { buildLandingMetadata } from '@/lib/landing/seo'
import Pricing from '@/app/(landing)/pricing/pricing'
import { pricingSearchParamsCache } from '@/app/(landing)/pricing/search-params'

export const revalidate = 3600

const TITLE = 'Pricing | Sim, the AI Workspace'
const DESCRIPTION =
  'Pricing for Sim, the open-source AI workspace for building, deploying, and managing AI agents. Compare the Free, Pro, Max, and Enterprise plans. Start free.'

/**
 * `billing` renders genuinely different prices server-side (see
 * search-params.ts), so the non-default variant is noindexed rather than
 * self-canonicalized — same policy as the integrations/models/blog catalogs.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}): Promise<Metadata> {
  const { billing } = await pricingSearchParamsCache.parse(searchParams)
  const isFiltered = billing !== 'monthly'

  const base = buildLandingMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: '/pricing',
    keywords:
      'Sim pricing, AI workspace pricing, AI agent platform pricing, build AI agents, Pro plan, Max plan, Enterprise plan, open-source AI agents, LLM pricing',
  })

  return { ...base, ...(isFiltered && { robots: { index: false, follow: true } }) }
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await pricingSearchParamsCache.parse(searchParams)
  return <Pricing />
}
