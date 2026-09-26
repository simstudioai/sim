'use client'

import type { ComponentProps, ReactNode } from 'react'
import { ChipSelect } from '@sim/emcn'
import { useQueryState } from 'nuqs'
import type { CredentialGroupOption } from '@/lib/api/contracts/credential-groups'
import { getCredentialGroupIndexingConnector } from '@/lib/credential-groups/indexing'
import { organizationPeopleIntegrationParam } from '@/app/o/[organizationId]/settings/components/integrations/search-params'
import { OrganizationAccountPeople } from '@/ee/credential-groups/components/organization-account-people'

interface OrganizationSourcePeopleProps
  extends Omit<ComponentProps<typeof OrganizationAccountPeople>, 'searchConnection' | 'filters'> {
  options: CredentialGroupOption[]
  tabs: ReactNode
}

export function OrganizationSourcePeople({
  options,
  tabs,
  ...props
}: OrganizationSourcePeopleProps) {
  const [integration, setIntegration] = useQueryState(
    organizationPeopleIntegrationParam.key,
    organizationPeopleIntegrationParam.parser
  )
  const integrations = options
    .flatMap((option) => {
      const connector = getCredentialGroupIndexingConnector(option.provider)
      return option.status === 'active' && connector
        ? [
            {
              optionId: option.id,
              type: connector.type,
              name: connector.meta.name,
              icon: connector.meta.icon,
              needsSetup: option.provider === 'slack' && option.configurationStatus !== 'ready',
            },
          ]
        : []
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  const selected = integrations.find((item) => item.type === integration)

  return (
    <OrganizationAccountPeople
      {...props}
      searchConnection={
        selected ? { optionId: selected.optionId, providerName: selected.name } : undefined
      }
      requestDisabled={selected?.needsSetup}
      filters={
        <div className='flex flex-col gap-2'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            {tabs}
            <ChipSelect
              aria-label='Filter people by integration'
              value={selected?.type ?? 'all'}
              onChange={(value) => void setIntegration(value === 'all' ? null : value)}
              disabled={props.enabled === false || Boolean(props.setupFallback)}
              options={[
                { value: 'all', label: 'All integrations' },
                ...integrations.map((item) => ({
                  value: item.type,
                  label: item.name,
                  icon: item.icon,
                })),
              ]}
            />
          </div>
          {selected?.needsSetup && (
            <p className='text-[var(--text-muted)] text-caption'>
              Update the Slack app from Sources before requesting connections.
            </p>
          )}
        </div>
      }
    />
  )
}
