import { IntegrationCenter } from '@/platform/app/(shell)/integrations/_components/integration-center/integration-center'
import type {
  GenericSecrets,
  OrganizationIntegration,
} from '@/platform/lib/data/integrations-types'
import type { AppSummary } from '@/platform/lib/integrations/center-model'
import { appCategory } from '@/platform/lib/integrations/center-navigation'

interface IntegrationListProps {
  integrations: readonly OrganizationIntegration[]
  secrets: GenericSecrets | null
  integrationHref: (id: string) => string
  secretsHref: string
  /** False while a read could still add rows, so an empty list is not claimed too early. */
  settled: boolean
}

export function IntegrationList({
  integrations,
  secrets,
  integrationHref,
  secretsHref,
  settled,
}: IntegrationListProps) {
  const apps: AppSummary[] = integrations.map((item) => ({
    id: item.id,
    providerId: item.providerId,
    icon: item.icon,
    href: integrationHref(item.id),
    name: item.name,
    description: item.description,
    category: appCategory(item.providerId),
    connected: item.accounts.length > 0 || item.availability === 'managed',
    status: item.status,
    searchable: [item.providerId, ...item.accounts.map((account) => account.label)].join(' '),
  }))
  const credentials: AppSummary[] = secrets
    ? [
        {
          id: 'generic-secrets',
          href: secretsHref,
          name: secrets.name,
          description: secrets.description,
          category: 'Credentials',
          scope: secrets.mode === 'organization' ? 'shared' : 'personal',
          connected: secrets.mode === 'organization',
          status: secrets.mode === 'organization' ? 'Organization managed' : 'Personal secrets',
        },
      ]
    : []
  return <IntegrationCenter apps={apps} credentials={credentials} settled={settled} />
}
