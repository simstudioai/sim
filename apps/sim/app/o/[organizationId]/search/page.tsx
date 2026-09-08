import type { Metadata } from 'next'
import { OrganizationSearch } from '@/app/o/[organizationId]/search/search'

export const metadata: Metadata = {
  title: 'Search',
}

export default function OrganizationSearchPage() {
  return <OrganizationSearch />
}
