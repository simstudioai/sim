'use client'

import { useSearchParams } from 'next/navigation'
import { useIntegrationCenterResources } from '@/platform/app/(shell)/_components/session/integration-center-changes'
import { useOrganizationIntegrations } from '@/platform/app/(shell)/_components/session/integration-changes'
import { IntegrationDetails } from '@/platform/app/(shell)/integrations/_components/fixtures/integration-details/integration-details'
import { MemberSecrets } from '@/platform/app/(shell)/integrations/_components/fixtures/member-secrets/member-secrets'
import { ProviderHeading } from '@/platform/app/(shell)/integrations/_components/fixtures/provider-heading/provider-heading'
import { IntegrationCenter } from '@/platform/app/(shell)/integrations/_components/integration-center/integration-center'
import {
  IntegrationsHeading,
  IntegrationsPage as PageFrame,
} from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-page'
import type { IntegrationCenterData } from '@/platform/lib/integrations/center-model'
import { appCategory } from '@/platform/lib/integrations/center-navigation'
import {
  type IntegrationsData,
  memberIntegrationHref,
  memberStatus,
} from '@/platform/lib/integrations/fixture-model'

interface IntegrationsPageProps {
  data: IntegrationsData | null
  center: IntegrationCenterData | null
  section?: string
}

export function IntegrationsPage({ data, center, section }: IntegrationsPageProps) {
  const search = useSearchParams()
  const { integrations, save } = useOrganizationIntegrations(data)
  const library = useIntegrationCenterResources(center)
  const item = integrations.find((entry) => entry.providerId === section)
  const secrets = section === 'secrets' ? data?.genericSecrets : null
  return (
    <PageFrame
      back={
        item || secrets
          ? { href: memberIntegrationHref('/integrations', search), label: 'Integrations' }
          : undefined
      }
    >
      {item || secrets ? (
        <>
          {item && <IntegrationDetails key={item.providerId} integration={item} onChange={save} />}
          {secrets && (
            <>
              <ProviderHeading name={secrets.name} description={secrets.description} />
              <MemberSecrets source={secrets} />
            </>
          )}
        </>
      ) : (
        <>
          <IntegrationsHeading />
          <IntegrationCenter
            apps={integrations.map((integration) => ({
              id: integration.providerId,
              name: integration.name,
              description: integration.description,
              category: appCategory(integration.providerId),
              href: memberIntegrationHref(`/integrations/${integration.providerId}`, search),
              connected: Boolean(integration.account),
              status: memberStatus(integration),
              searchable: integration.account?.label,
              people: center?.appPeople[integration.providerId],
            }))}
            library={
              center
                ? {
                    data: { ...center, resources: library.resources },
                    save: library.save,
                    remove: library.remove,
                  }
                : undefined
            }
            credentials={
              data?.genericSecrets
                ? [
                    {
                      id: 'secrets',
                      name: data.genericSecrets.name,
                      description: data.genericSecrets.description,
                      category: 'Credentials',
                      scope: data.genericSecrets.mode === 'organization' ? 'shared' : 'personal',
                      connected: true,
                      href: memberIntegrationHref('/integrations/secrets', search),
                    },
                  ]
                : []
            }
          />
        </>
      )}
    </PageFrame>
  )
}
