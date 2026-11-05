'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useOrganizationIntegrations } from '@/platform/app/(shell)/_components/session/integration-changes'
import { IntegrationCatalog } from '@/platform/app/(shell)/integrations/_components/integration-catalog/integration-catalog'
import { IntegrationSetup } from '@/platform/app/(shell)/integrations/_components/integration-catalog/integration-setup'
import { IntegrationDetails } from '@/platform/app/(shell)/integrations/_components/integration-details/integration-details'
import { IntegrationList } from '@/platform/app/(shell)/integrations/_components/integration-list/integration-list'
import styles from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-page.module.css'
import { WorkspaceAccessList } from '@/platform/app/(shell)/integrations/_components/workspace-access/workspace-access'
import { Button, Chip, DestinationTabs, EmptyState } from '@/platform/design-system/components'
import { Icon } from '@/platform/design-system/components/icon/icon'
import { platformHref } from '@/platform/design-system/navigation'
import type { IntegrationDraft, IntegrationsData } from '@/platform/lib/integrations/model'

interface IntegrationsPageProps {
  data: IntegrationsData | null
  section?: string
}

export function IntegrationsPage({ data, section }: IntegrationsPageProps) {
  const router = useRouter()
  const search = useSearchParams()
  const [catalog, setCatalog] = useState(false)
  const { configured, grants, save, remove, setAccess } = useOrganizationIntegrations(data)
  const index = platformHref('/integrations', search)
  const access = platformHref('/integrations/access', search)
  const provider = data?.providers.find((entry) => entry.id === section)
  const integration = provider && configured.get(provider.id)
  const showAccess = section === 'access'
  const canManage = Boolean(data?.canManage)

  function add(draft: IntegrationDraft) {
    if (!canManage || configured.has(draft.providerId)) return
    save({
      providerId: draft.providerId,
      searchApproved: draft.searchMode !== null,
      searchMode: draft.searchMode,
      accountMethods: draft.accountMethod ? [draft.accountMethod] : [],
      label: draft.label,
      required: draft.required,
      endpoint: draft.endpoint,
      clientId: draft.clientId,
      sources: [],
      sourceId: null,
      accounts: [],
      people: [],
    })
    setCatalog(false)
    router.push(platformHref(`/integrations/${draft.providerId}`, search))
  }
  return (
    <main className={styles.page}>
      {provider ? (
        <>
          <nav aria-label='Integration navigation' className={styles.back}>
            <Chip href={index} icon='I093'>
              Integrations
            </Chip>
          </nav>
          <header className={styles.providerHeading}>
            <span className={styles.mark}>
              <Icon providerId={provider.id} />
            </span>
            <div className={styles.heading}>
              <h1 data-type='T076'>{provider.name}</h1>
              <p data-type='T048'>{provider.description}</p>
            </div>
          </header>
          {integration ? (
            <IntegrationDetails
              key={provider.id}
              provider={provider}
              integration={integration}
              canManage={canManage}
              onChange={save}
              onRemove={() => {
                remove(provider.id)
                router.replace(index)
              }}
            />
          ) : (
            <EmptyState
              title='Integration not added'
              action={
                canManage ? (
                  <Button onClick={() => setCatalog(true)}>Add integration</Button>
                ) : undefined
              }
            />
          )}
        </>
      ) : (
        <>
          <header className={styles.heading}>
            <div className={styles.headline}>
              <h1 data-type='T076'>Integrations</h1>
              {canManage && (
                <Button icon='I074' onClick={() => setCatalog(true)}>
                  Add integration
                </Button>
              )}
            </div>
            <p data-type='T048'>Manage the apps your organization uses for search and workflows.</p>
          </header>
          {canManage && (
            <div className={styles.tabs}>
              <DestinationTabs
                label='Integration sections'
                currentHref={showAccess ? access : index}
                destinations={[
                  { label: 'Apps', href: index },
                  { label: 'Workspace access', href: access },
                ]}
              />
            </div>
          )}
          {showAccess ? (
            canManage && data ? (
              <WorkspaceAccessList
                workspaces={data.workspaces}
                credentialTypes={data.credentialTypes}
                grants={grants}
                onSave={setAccess}
              />
            ) : (
              <EmptyState
                title='Workspace access is managed by your organization'
                action={<Chip href={index}>View integrations</Chip>}
              />
            )
          ) : (
            <IntegrationList
              providers={data?.providers ?? []}
              configured={configured}
              canManage={canManage}
            />
          )}
        </>
      )}
      {catalog &&
        canManage &&
        data &&
        (provider && !integration ? (
          <IntegrationSetup provider={provider} onCancel={() => setCatalog(false)} onAdd={add} />
        ) : (
          <IntegrationCatalog
            providers={data.providers}
            installedIds={[...configured.keys()]}
            onAdd={add}
            onClose={() => setCatalog(false)}
          />
        ))}
    </main>
  )
}
