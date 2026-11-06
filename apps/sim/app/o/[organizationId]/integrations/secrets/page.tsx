import type { Metadata } from 'next'
import { createLoader, type SearchParams } from 'nuqs/server'
import { organizationRoutes } from '@/lib/navigation/paths'
import {
  integrationSearchParsers,
  serializeIntegrationView,
} from '@/lib/organizations/integrations-search-params'
import { OrganizationSecretsPage } from '@/app/o/[organizationId]/integrations/secrets/organization-secrets-page'

export const metadata: Metadata = { title: 'Generic Secrets' }

interface MemberSecretsPageProps {
  params: Promise<{ organizationId: string }>
  searchParams: Promise<SearchParams>
}

const loadSearch = createLoader(integrationSearchParsers)

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
