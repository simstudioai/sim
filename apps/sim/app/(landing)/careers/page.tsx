import type { SearchParams } from 'nuqs/server'
import { buildLandingMetadata } from '@/lib/landing/seo'
import Careers from '@/app/(landing)/careers/careers'

export const revalidate = 3600

export const metadata = buildLandingMetadata({
  title: 'Careers at Sim — Build the AI workspace for teams',
  description:
    'Join Sim, the open-source AI workspace where teams build, deploy, and manage AI agents. See open engineering, design, and go-to-market roles.',
  path: '/careers',
  keywords: 'Sim careers, Sim jobs, AI workspace jobs, AI agent engineering jobs, open source jobs',
})

export default function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <Careers searchParams={searchParams} />
}
