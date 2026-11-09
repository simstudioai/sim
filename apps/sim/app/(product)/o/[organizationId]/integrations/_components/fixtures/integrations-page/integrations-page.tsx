'use client'

import { useSearchParams } from 'next/navigation'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { useIntegrationCenterResources } from '@/app/(product)/_components/session/integration-center-changes'
import { useOrganizationIntegrations } from '@/app/(product)/_components/session/integration-changes'
import { IntegrationDetails } from '@/app/(product)/o/[organizationId]/integrations/_components/fixtures/integration-details/integration-details'
import { MemberSecrets } from '@/app/(product)/o/[organizationId]/integrations/_components/fixtures/member-secrets/member-secrets'
import { IntegrationCenter } from '@/app/(product)/o/[organizationId]/integrations/_components/integration-center/integration-center'
import {
  IntegrationsHeading,
  IntegrationsPage as PageFrame,
} from '@/app/(product)/o/[organizationId]/integrations/_components/integrations-page/integrations-page'
import { ProviderHeading } from '@/app/(product)/o/[organizationId]/integrations/_components/provider-heading/provider-heading'
import type { IntegrationCatalogEntry } from '@/platform/lib/integrations/catalog-model'
import type { AppSummary, IntegrationCenterData } from '@/platform/lib/integrations/center-model'
import {
  credentialDescription,
  credentialSharing,
} from '@/platform/lib/integrations/credential-display'
import {
  clearCredentialView,
  serializeCredential,
} from '@/platform/lib/integrations/credential-navigation'
import {
  type IntegrationsData,
  memberIntegrationHref,
} from '@/platform/lib/integrations/fixture-model'

interface IntegrationsPageProps {
  data: IntegrationsData | null
  center: IntegrationCenterData | null
  section?: string
  catalog?: IntegrationCatalogEntry | null
}

export function IntegrationsPage({ data, center, section, catalog }: IntegrationsPageProps) {
  return (
    <NuqsAdapter>
      <IntegrationsContent data={data} center={center} section={section} catalog={catalog} />
    </NuqsAdapter>
  )
}

function IntegrationsContent({ data, center, section, catalog }: IntegrationsPageProps) {
  const search = useSearchParams()
  const { integrations, save } = useOrganizationIntegrations(data)
  const library = useIntegrationCenterResources(center)
  const item = integrations.find((entry) => entry.providerId === section)
  const secrets = section === 'secrets' ? data?.genericSecrets : null
  const manualCredentials = library.resources.filter((resource) => resource.kind === 'credential')
  const credentialLinks: AppSummary[] = [
    ...new Map(
      integrations.flatMap((integration) =>
        integration.credentials
          .filter(
            (credential) =>
              credential.type === 'service_account' ||
              credential.type === 'personal_token' ||
              credential.type === 'slack'
          )
          .map((credential) => [credential.id, credential] as const)
      )
    ).values(),
  ].map((credential) => ({
    id: credential.id,
    providerId: credential.appId,
    name: credential.displayName,
    description: credentialDescription(credential),
    category: 'Credentials',
    connected: true,
    scope: credentialSharing(credential),
    href: serializeCredential(
      memberIntegrationHref(`/integrations/${encodeURIComponent(credential.appId)}`, search),
      { credential: credential.id, credentialFrom: 'credentials' }
    ),
  }))
  return (
    <PageFrame
      back={
        (item && !center) || secrets
          ? { href: memberIntegrationHref('/integrations', search), label: 'Integrations' }
          : undefined
      }
    >
      {item || secrets ? (
        <>
          {item && center && (
            <IntegrationDetails
              key={item.providerId}
              integration={item}
              backHrefs={{
                integrations: memberIntegrationHref('/integrations', search),
                credentials: serializeCredential(memberIntegrationHref('/integrations', search), {
                  ...clearCredentialView,
                  credential: null,
                }),
                app: serializeCredential(
                  memberIntegrationHref(
                    `/integrations/${encodeURIComponent(item.providerId)}`,
                    search
                  ),
                  { ...clearCredentialView, credential: null }
                ),
              }}
              onChange={save}
              knownCredentials={integrations.flatMap((entry) => entry.credentials)}
              organization={center.organization}
              viewer={center.viewer}
              eligiblePeople={center.people}
              workspaces={center.workspaces}
              catalog={catalog}
              library={{
                data: { ...center, resources: library.resources },
                save: library.save,
                remove: library.remove,
                leave: library.leave,
              }}
              people={center?.appPeople[item.providerId]}
              peopleTotal={center?.appUsageTotal[item.providerId]}
            />
          )}
          {secrets && (
            <>
              <ProviderHeading name={secrets.name} description={secrets.description} />
              <MemberSecrets source={secrets} />
            </>
          )}
        </>
      ) : (
        <IntegrationCenter
          heading={<IntegrationsHeading />}
          apps={integrations.map((integration) => ({
            id: integration.providerId,
            name: integration.name,
            description: integration.description,
            category: integration.category ?? 'Other',
            href: memberIntegrationHref(`/integrations/${integration.providerId}`, search),
            connected:
              integration.credentials.length > 0 ||
              manualCredentials.some((credential) => credential.appId === integration.providerId),
            credentialCount:
              integration.credentials.length +
              manualCredentials.filter((credential) => credential.appId === integration.providerId)
                .length,
            searchable: integration.credentials
              .map((credential) => `${credential.displayName} ${credential.accountLabel ?? ''}`)
              .join(' '),
            people: center?.appPeople[integration.providerId],
            peopleTotal: center?.appUsageTotal[integration.providerId],
          }))}
          library={
            center
              ? {
                  data: { ...center, resources: library.resources },
                  save: library.save,
                  remove: library.remove,
                  leave: library.leave,
                }
              : undefined
          }
          credentials={[
            ...credentialLinks,
            ...(data?.genericSecrets
              ? [
                  {
                    id: 'secrets',
                    name: data.genericSecrets.name,
                    description: data.genericSecrets.description,
                    category: 'Credentials',
                    scope:
                      data.genericSecrets.mode === 'organization'
                        ? ('shared' as const)
                        : ('personal' as const),
                    connected: true,
                    href: memberIntegrationHref('/integrations/secrets', search),
                  },
                ]
              : []),
          ]}
        />
      )}
    </PageFrame>
  )
}
