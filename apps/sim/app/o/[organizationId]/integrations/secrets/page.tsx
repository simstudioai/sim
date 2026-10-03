import type { Metadata } from 'next'
import { OrganizationSecretsPage } from '@/components/secrets/organization-secrets-page'

export const metadata: Metadata = { title: 'Generic Secrets' }

interface MemberSecretsPageProps {
  params: Promise<{ organizationId: string }>
}

export default async function Page({ params }: MemberSecretsPageProps) {
  const { organizationId } = await params
  return <OrganizationSecretsPage organizationId={organizationId} mode='member' />
}
