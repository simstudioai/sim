import type { Metadata } from 'next'
import { createLoader, type SearchParams } from 'nuqs/server'
import { OrganizationSecretsPage } from '@/components/secrets/organization-secrets-page'
import { organizationRoutes } from '@/lib/navigation/paths'
import { organizationPageParsers } from '@/app/o/[organizationId]/components/organization-page/search-params'
import { serializeIntegrationView } from '@/app/o/[organizationId]/integrations/search-params'

export const metadata: Metadata = { title: 'Generic Secrets' }

interface MemberSecretsPageProps {
  params: Promise<{ organizationId: string }>
  searchParams: Promise<SearchParams>
}

const loadSearch = createLoader(organizationPageParsers)

export default async function Page({ params, searchParams }: MemberSecretsPageProps) {
  const { organizationId } = await params
  const { q } = await loadSearch(searchParams)
  return (
    <OrganizationSecretsPage
      organizationId={organizationId}
      mode='member'
      backHref={serializeIntegrationView(organizationRoutes(organizationId).integrations, { q })}
    />
  )
}
