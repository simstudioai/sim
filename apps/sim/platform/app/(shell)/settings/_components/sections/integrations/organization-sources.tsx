'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { Icon } from '@sim/emcn/icon'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { SectionStack } from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import type { SearchSource } from '@/platform/app/(shell)/settings/_components/sections/integrations/model'
import { SourceRow } from '@/platform/app/(shell)/settings/_components/sections/integrations/source-row'

interface OrganizationSourcesProps {
  sources: SearchSource[]
  apps: { id: string; name: string; account?: string }[]
  secret: { mode: string } | null
  manageHref: string
}

export function OrganizationSources({
  sources,
  apps,
  secret,
  manageHref,
}: OrganizationSourcesProps) {
  const [query, setQuery] = useState('')
  const matches = (text: string) => text.toLowerCase().includes(query.trim().toLowerCase())
  const visibleSources = sources.filter((source) => matches(source.name))
  const visibleApps = apps.filter(
    (app) => matches(app.name) || Boolean(app.account && matches(app.account))
  )
  const showSecret = secret && matches('Generic Secrets')
  return (
    <SectionStack>
      <SearchField label='Search sources' placeholder='Search sources…' onValueChange={setQuery} />
      {visibleApps.length > 0 && (
        <SettingsSection title='Assistant apps'>
          {visibleApps.map((app) => (
            <SettingsRow
              key={app.id}
              leading={<Icon providerId={app.id} />}
              label={app.name}
              description={app.account ?? 'No account connected'}
            >
              <Button size='compact' render={<a href={manageHref}>Manage</a>}>
                Manage
              </Button>
            </SettingsRow>
          ))}
        </SettingsSection>
      )}
      <SettingsSection title='Search sources'>
        {visibleSources.map((source) => (
          <SourceRow key={source.id} source={source}>
            <Button
              size='compact'
              render={
                <a
                  href={
                    source.mode === 'service_account'
                      ? `${manageHref}/providers/${encodeURIComponent(source.id)}`
                      : manageHref
                  }
                >
                  Configure
                </a>
              }
            >
              Configure
            </Button>
          </SourceRow>
        ))}
        {showSecret && (
          <SettingsRow
            label='Generic Secrets'
            description={secret.mode === 'organization' ? 'Organization' : 'Member accounts'}
          >
            <Button size='compact' render={<a href={`${manageHref}/secrets`}>Configure</a>}>
              Configure
            </Button>
          </SettingsRow>
        )}
        {!visibleSources.length && !showSecret && (
          <EmptyState title={query.trim() ? 'No matching sources' : 'No Search sources'} />
        )}
        <SettingsRow label='Add source'>
          <Button size='compact' icon='I074' render={<a href={manageHref}>Add source</a>}>
            Add source
          </Button>
        </SettingsRow>
      </SettingsSection>
    </SectionStack>
  )
}
