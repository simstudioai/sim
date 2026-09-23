import type { Metadata } from 'next'
import { OrganizationSecretsPage } from '@/components/secrets/organization-secrets-page'

export const metadata: Metadata = { title: 'Generic Secrets' }

interface OrganizationSecretsPageProps {
  params: Promise<{ organizationId: string }>
}

export default async function Page({ params }: OrganizationSecretsPageProps) {
  const { organizationId } = await params
  return <OrganizationSecretsPage organizationId={organizationId} mode='organization' />
}
