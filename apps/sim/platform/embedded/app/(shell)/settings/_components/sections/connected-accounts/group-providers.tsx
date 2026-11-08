'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SectionSearch } from '@sim/emcn/search-field/section-search'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { useQueryState } from 'nuqs'
import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'
import type { ManagedMcpConnectorId } from '@/lib/credential-groups/managed-mcp-connectors'
import { MANAGED_MCP_CONNECTORS } from '@/lib/credential-groups/managed-mcp-connectors'
import type { CredentialGroupProvider } from '@/lib/credential-groups/providers'
import { getCredentialGroupProviderService } from '@/lib/credential-groups/providers'
import {
  credentialGroupProviderSearchParam,
  credentialGroupProviderSearchUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/[section]/search-params'
import {
  type OrganizationAccountProviderChoice,
  organizationAccountProviderRows,
} from '@/ee/credential-groups/provider-rows'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { IntegrationMark } from '@/platform/embedded/app/(shell)/_components/integration-mark/integration-mark'
import {
  ActionRow,
  Muted,
  SectionStack,
  SectionToolbar,
} from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import { DatabricksModal } from '@/platform/embedded/app/(shell)/settings/_components/sections/connected-accounts/databricks-modal'
import { ProviderCatalogModal } from '@/platform/embedded/app/(shell)/settings/_components/sections/connected-accounts/provider-catalog-modal'
import { SlackMemberSetupModal } from '@/platform/embedded/app/(shell)/settings/_components/sections/connected-accounts/slack-member-setup-modal'
import { useCredentialGroupProviders } from '@/platform/embedded/lib/data/integrations'

interface GroupProvidersProps {
  organizationId: string
  group: NonNullable<OrganizationAccountsSettings['credentialGroup']>
  availableProviders: CredentialGroupProvider[]
  availableMcpConnectors?: readonly ManagedMcpConnectorId[]
}

export function GroupProviders({
  organizationId,
  group,
  availableProviders,
  availableMcpConnectors,
}: GroupProvidersProps) {
  const [searchTerm, setSearchParam] = useQueryState(credentialGroupProviderSearchParam.key, {
    ...credentialGroupProviderSearchParam.parser,
    ...credentialGroupProviderSearchUrlKeys,
  })
  const setSearchTerm = useDebouncedSearchSetter(setSearchParam)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [removing, setRemoving] = useState<OrganizationAccountProviderChoice | null>(null)
  const [slackOpen, setSlackOpen] = useState(false)
  const [databricksOpen, setDatabricksOpen] = useState(false)
  const providers = useCredentialGroupProviders(organizationId, group)
  const { pending, error } = providers

  function addProvider(choice: OrganizationAccountProviderChoice) {
    if (choice.kind === 'mcp') {
      if (choice.connectorId === 'databricks') {
        setCatalogOpen(false)
        setDatabricksOpen(true)
        return
      }
      providers.addMcpConnector(choice.connectorId, () => setCatalogOpen(false))
      return
    }
    const { provider } = choice
    if (provider === 'slack') {
      setCatalogOpen(false)
      setSlackOpen(true)
      return
    }
    providers.addOAuthProvider(provider, () => setCatalogOpen(false))
  }

  async function removeProvider() {
    if (!removing || pending) return false
    await providers.remove(removing)
  }

  const rows = organizationAccountProviderRows(group)
  const normalizedSearch = searchTerm.trim().toLowerCase()
  const visibleRows = rows.filter((row) => row.name.toLowerCase().includes(normalizedSearch))
  const removingName = removing
    ? removing.kind === 'oauth'
      ? getCredentialGroupProviderService(removing.provider).name
      : MANAGED_MCP_CONNECTORS[removing.connectorId].name
    : ''

  return (
    <SectionStack>
      <SectionToolbar
        grow={
          <SectionSearch subject='providers' value={searchTerm} onValueChange={setSearchTerm} />
        }
      >
        <Button
          variant='primary'
          size='compact'
          icon='I074'
          disabled={pending}
          onClick={() => {
            providers.reset()
            setCatalogOpen(true)
          }}
        >
          Add provider
        </Button>
      </SectionToolbar>
      <SettingsSection title='Providers'>
        {visibleRows.map(({ id, name, icon, choice }) => {
          const providerId = choice.kind === 'oauth' ? choice.provider : choice.connectorId
          const configure =
            providerId === 'slack'
              ? () => setSlackOpen(true)
              : providerId === 'databricks'
                ? () => setDatabricksOpen(true)
                : undefined
          return (
            <SettingsRow
              key={id}
              label={name}
              leading={<IntegrationMark providerId={providerId} icon={icon} />}
            >
              <ActionRow>
                {configure && (
                  <Button size='compact' disabled={pending} onClick={configure}>
                    Configure
                  </Button>
                )}
                <ActionMenu
                  label={`${name} actions`}
                  icon='I108'
                  actions={[
                    {
                      id: 'remove',
                      label: 'Remove',
                      destructive: true,
                      disabled: pending,
                      onSelect: () => {
                        providers.reset()
                        setRemoving(choice)
                      },
                    },
                  ]}
                />
              </ActionRow>
            </SettingsRow>
          )
        })}
        {!visibleRows.length && (
          <EmptyState
            title={
              normalizedSearch
                ? 'No providers match your search'
                : 'Add a provider to start connecting accounts.'
            }
          />
        )}
        {providers.canUpdateConfigurations && (
          <SettingsRow
            label='Provider configurations'
            description='Apply the current app configuration. Accounts whose app configuration changed will need to reconnect.'
          >
            <Button size='compact' disabled={pending} onClick={providers.updateConfigurations}>
              Update configurations
            </Button>
          </SettingsRow>
        )}
      </SettingsSection>
      {catalogOpen && (
        <ProviderCatalogModal
          group={group}
          availableProviders={availableProviders}
          availableMcpConnectors={availableMcpConnectors}
          pending={pending}
          error={error?.message}
          onClose={() => setCatalogOpen(false)}
          onAdd={addProvider}
        />
      )}
      {databricksOpen && (
        <DatabricksModal
          organizationId={organizationId}
          existingServer={group.mcpServers.find(
            (server) => server.managedConnectorId === 'databricks'
          )}
          onClose={() => setDatabricksOpen(false)}
        />
      )}
      {slackOpen && (
        <SlackMemberSetupModal
          organizationId={organizationId}
          credentialGroupId={group.id}
          initialRequiredScopes={
            group.options.find((option) => option.provider === 'slack')?.requiredScopes
          }
          onOpenChange={setSlackOpen}
        />
      )}
      {removing && (
        <ConfirmDialog
          target
          onClose={() => setRemoving(null)}
          title={`Remove ${removingName}`}
          confirmLabel='Remove'
          pendingLabel='Removing…'
          onConfirm={removeProvider}
        >
          <Muted>Remove this provider and its connected accounts from the organization?</Muted>
        </ConfirmDialog>
      )}
    </SectionStack>
  )
}
