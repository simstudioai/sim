import type { Metadata } from 'next'
import type { SearchParams } from 'nuqs/server'
import { buildLandingMetadata, withFilteredNoindex } from '@/lib/landing/seo'
import Careers from '@/app/(landing)/careers/careers'
import { ALL_FILTER_VALUE, careersSearchParamsCache } from '@/app/(landing)/careers/search-params'

/**
 * `team`/`location` render a genuinely different server-rendered job list (see
 * search-params.ts), so filtered URLs are noindexed rather than
 * self-canonicalized — same policy as the integrations/models/blog catalogs.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}): Promise<Metadata> {
  const { team, location } = await careersSearchParamsCache.parse(searchParams)
  const isFiltered = team !== ALL_FILTER_VALUE || location !== ALL_FILTER_VALUE

  const base = buildLandingMetadata({
    title: 'Careers | Sim, the AI Workspace',
    description:
      'Join Sim, the open-source AI workspace where teams build, deploy, and manage AI agents. See open engineering, design, and go-to-market roles.',
    path: '/careers',
    keywords:
      'Sim careers, Sim jobs, AI workspace jobs, AI agent engineering jobs, open source jobs',
  })

  return withFilteredNoindex(base, isFiltered)
}

export default function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <Careers searchParams={searchParams} />
}
