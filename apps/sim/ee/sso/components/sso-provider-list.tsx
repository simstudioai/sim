'use client'

import type { SsoProviderView } from '@/lib/api/contracts/auth'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'

interface SsoProviderListProps {
  providers: SsoProviderView[]
  active: boolean
  docsLink: string
  onAdd: () => void
  onOpen: (providerId: string) => void
}

/**
 * The organization's identity providers.
 *
 * One provider serves each verified domain, so the rows read as a routing table:
 * which domain signs in where.
 */
export function SsoProviderList({
  providers,
  active,
  onAdd,
  onOpen,
  docsLink,
}: SsoProviderListProps) {
  return (
    <>
      {active && (
        <SettingsPanel
          docsLink={docsLink}
          actions={[{ text: 'Add identity provider', variant: 'primary', onSelect: onAdd }]}
        />
      )}

      <SettingsSection label='Identity providers'>
        <div className={RESOURCE_LIST_STACK}>
          {providers.map((provider) => {
            const providerId = provider.providerId ?? ''
            return (
              <SettingsResourceRow
                key={provider.id ?? providerId}
                title={providerId}
                description={`${(provider.providerType ?? 'oidc').toUpperCase()} · ${provider.domain ?? 'no domain'}`}
                onClick={() => onOpen(providerId)}
                clickLabel={`Open ${providerId}`}
                navigable
              />
            )
          })}
        </div>
      </SettingsSection>
    </>
  )
}
