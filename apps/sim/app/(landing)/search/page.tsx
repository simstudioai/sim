import { buildLandingMetadata } from '@/lib/landing/seo'
import Search, { SEARCH_PAGE_DESCRIPTION } from '@/app/(landing)/search/search'

export const revalidate = 3600

export const metadata = buildLandingMetadata({
  title: 'Sim Search | Enterprise AI Search & Chat',
  description: SEARCH_PAGE_DESCRIPTION,
  path: '/search',
})

export default function Page() {
  return <Search />
}
