'use client'

import { useState } from 'react'
import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'
import type { ManagedMcpConnectorId } from '@/lib/credential-groups/managed-mcp-connectors'
import type { CredentialGroupProvider } from '@/lib/credential-groups/providers'
import {
  type OrganizationAccountProviderChoice,
  organizationAccountCatalogEntries,
} from '@/ee/credential-groups/provider-rows'
import {
  Button,
  EmptyState,
  InlineNotice,
  Modal,
  SectionSearch,
} from '@/platform/design-system/components'
import { SettingsRow } from '@/platform/design-system/components/settings-section/settings-section'
import { IntegrationMark } from '@/platform/embedded/app/(shell)/_components/integration-mark/integration-mark'

interface ProviderCatalogModalProps {
  group: NonNullable<OrganizationAccountsSettings['credentialGroup']>
  availableProviders: CredentialGroupProvider[]
  availableMcpConnectors?: readonly ManagedMcpConnectorId[]
  pending: boolean
  error?: string
  onClose: () => void
  onAdd: (choice: OrganizationAccountProviderChoice) => void
}

export function ProviderCatalogModal({
  group,
  availableProviders,
  availableMcpConnectors,
  pending,
  error,
  onClose,
  onAdd,
}: ProviderCatalogModalProps) {
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const providers = organizationAccountCatalogEntries(
    group,
    availableProviders,
    availableMcpConnectors,
    query
  )
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
      title='Add provider'
      cancelLabel='Close'
      confirmLabel='Done'
    >
      <SectionSearch subject='providers' value={search} onValueChange={setSearch} />
      {providers.map(({ name, icon, choice }) => {
        const providerId = choice.kind === 'oauth' ? choice.provider : choice.connectorId
        return (
          <SettingsRow
            key={`${choice.kind}:${providerId}`}
            label={name}
            leading={<IntegrationMark providerId={providerId} icon={icon} />}
          >
            <Button size='compact' disabled={pending} onClick={() => onAdd(choice)}>
              Add
            </Button>
          </SettingsRow>
        )
      })}
      {!providers.length && (
        <EmptyState
          title={query ? 'No matching providers.' : 'All available providers have been added.'}
        />
      )}
      {error && <InlineNotice intent='danger' message={error} />}
    </Modal>
  )
}
