'use client'

import { ChipTag } from '@sim/emcn-legacy'
import { SettingsPanel } from '@/components/settings/primitives/settings-panel'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/components/settings/primitives/settings-resource-row'
import { SettingsSection } from '@/components/settings/primitives/settings-section/settings-section'
import type { SsoProviderView } from '@/lib/api/contracts/auth'

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
 * The rows read as a routing table: which domain signs in where. A domain with
 * more than one provider marks the one sign-in uses, so an organization moving
 * between identity providers can see which is live.
 */
export function SsoProviderList({
  providers,
  active,
  onAdd,
  onOpen,
  docsLink,
}: SsoProviderListProps) {
  const providerCountByDomain = new Map<string, number>()
  for (const provider of providers) {
    const domainKey = provider.domainKey ?? ''
    providerCountByDomain.set(domainKey, (providerCountByDomain.get(domainKey) ?? 0) + 1)
  }

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
                badge={
                  provider.isPrimary &&
                  (providerCountByDomain.get(provider.domainKey ?? '') ?? 0) > 1 ? (
                    <ChipTag variant='gray'>Primary</ChipTag>
                  ) : undefined
                }
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
