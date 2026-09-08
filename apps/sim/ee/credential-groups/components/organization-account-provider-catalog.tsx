'use client'

import { useState } from 'react'
import {
  Chip,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalHeader,
} from '@sim/emcn'
import { Search } from '@sim/emcn/icons'
import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'
import { getManagedMcpConnectorIcon } from '@/lib/credential-groups/managed-mcp-connector-icons'
import {
  MANAGED_MCP_CONNECTOR_IDS,
  MANAGED_MCP_CONNECTORS,
  type ManagedMcpConnectorId,
} from '@/lib/credential-groups/managed-mcp-connectors'
import {
  type CredentialGroupProvider,
  getCredentialGroupProviderService,
} from '@/lib/credential-groups/providers'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'

export type OrganizationAccountProviderChoice =
  | { kind: 'oauth'; provider: CredentialGroupProvider }
  | { kind: 'mcp'; connectorId: ManagedMcpConnectorId }

interface OrganizationAccountProviderCatalogProps {
  group: NonNullable<OrganizationAccountsSettings['credentialGroup']>
  availableProviders: CredentialGroupProvider[]
  pending: boolean
  error: string | undefined
  onClose: () => void
  onAdd: (choice: OrganizationAccountProviderChoice) => void
}

export function OrganizationAccountProviderCatalog({
  group,
  availableProviders,
  pending,
  error,
  onClose,
  onAdd,
}: OrganizationAccountProviderCatalogProps) {
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const providers = [
    ...availableProviders
      .filter((provider) => !group.options.some((option) => option.provider === provider))
      .map((provider) => ({
        ...getCredentialGroupProviderService(provider),
        choice: { kind: 'oauth', provider } as const,
      })),
    ...MANAGED_MCP_CONNECTOR_IDS.filter(
      (id) =>
        !group.mcpServers.some(
          (server) => server.managedConnectorId === id && (id !== 'databricks' || server.enabled)
        )
    ).map((connectorId) => ({
      name: MANAGED_MCP_CONNECTORS[connectorId].name,
      icon: getManagedMcpConnectorIcon(connectorId),
      choice: { kind: 'mcp', connectorId } as const,
    })),
  ]
    .filter((provider) => provider.name.toLowerCase().includes(query))
    .sort((left, right) => left.name.localeCompare(right.name))

  return (
    <ChipModal
      open
      srTitle='Add provider'
      dismissDisabled={pending}
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <ChipModalHeader onClose={onClose} closeDisabled={pending}>
        Add provider
      </ChipModalHeader>
      <ChipModalBody className='h-[480px] max-h-[70dvh] flex-none overflow-hidden'>
        <ChipModalField
          type='custom'
          title='Find a provider'
          submitOnEnter={false}
          className='shrink-0'
        >
          <ChipInput
            icon={Search}
            aria-label='Search providers'
            placeholder='Search providers'
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </ChipModalField>
        <ChipModalField type='custom' title='Available providers' className='min-h-0 flex-1'>
          <div className='-mx-2 min-h-0 flex-1 overflow-y-auto px-2 [scrollbar-gutter:stable]'>
            <div className={RESOURCE_LIST_STACK}>
              {providers.map(({ name, icon: Icon, choice }) => (
                <SettingsResourceRow
                  key={choice.kind === 'oauth' ? choice.provider : choice.connectorId}
                  icon={<Icon aria-hidden />}
                  title={name}
                  trailing={
                    <Chip
                      aria-label={`Add ${name}`}
                      disabled={pending}
                      onClick={() => onAdd(choice)}
                    >
                      Add
                    </Chip>
                  }
                />
              ))}
              {!providers.length && (
                <SettingsEmptyState variant='inline'>
                  {query ? 'No matching providers.' : 'All available providers have been added.'}
                </SettingsEmptyState>
              )}
            </div>
          </div>
        </ChipModalField>
        <ChipModalError>{error}</ChipModalError>
      </ChipModalBody>
    </ChipModal>
  )
}
