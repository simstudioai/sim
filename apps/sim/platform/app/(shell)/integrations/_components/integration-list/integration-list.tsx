import {
  IntegrationCenter,
  type SkillsTab,
} from '@/platform/app/(shell)/integrations/_components/integration-center/integration-center'
import type { AppSummary } from '@/platform/lib/integrations/center-model'
import type { GenericSecrets, OrganizationIntegration } from '@/platform/shared/integrations'

interface IntegrationListProps {
  integrations: readonly OrganizationIntegration[]
  secrets: GenericSecrets | null
  integrationHref: (id: string) => string
  secretsHref: string
  /** False while a read could still add rows, so an empty list is not claimed too early. */
  settled: boolean
  /** The workspace skills tab, on live data. */
  skills?: SkillsTab
}

export function IntegrationList({
  integrations,
  secrets,
  integrationHref,
  secretsHref,
  settled,
  skills,
}: IntegrationListProps) {
  const apps: AppSummary[] = integrations.map((item) => ({
    id: item.id,
    providerId: item.providerId,
    icon: item.icon,
    href: integrationHref(item.id),
    name: item.name,
    description: item.description,
    category: item.category,
    connected: item.accounts.length > 0,
    credentialCount: item.accounts.length,
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
        },
      ]
    : []
  return (
    <IntegrationCenter apps={apps} credentials={credentials} skills={skills} settled={settled} />
  )
}
