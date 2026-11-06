'use client'

import { useState } from 'react'
import { toast } from '@sim/emcn'
import { useQueryState } from 'nuqs'
import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'
import type { ManagedMcpConnectorId } from '@/lib/credential-groups/managed-mcp-connectors'
import type { CredentialGroupProvider } from '@/lib/credential-groups/providers'
import { IntegrationMark } from '@/platform/app/(shell)/integrations/_components/integration-mark/integration-mark'
import {
  ActionRow,
  Muted,
  SectionStack,
  SectionToolbar,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import { DatabricksModal } from '@/platform/app/(shell)/settings/_components/sections/connected-accounts/databricks-modal'
import { ProviderCatalogModal } from '@/platform/app/(shell)/settings/_components/sections/connected-accounts/provider-catalog-modal'
import { SlackMemberSetupModal } from '@/platform/app/(shell)/settings/_components/sections/connected-accounts/slack-member-setup-modal'
import {
  ActionMenu,
  Button,
  ConfirmDialog,
  EmptyState,
  SearchField,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import {
  credentialGroupProviderSearchParam,
  credentialGroupProviderSearchUrlKeys,
  getCredentialGroupProviderService,
  getOrganizationAccountUpdateOptions,
  MANAGED_MCP_CONNECTORS,
  type OrganizationAccountProviderChoice,
  organizationAccountProviderRows,
  useAddOrganizationAccountMcpProvider,
  useDebouncedSearchSetter,
  useRemoveOrganizationAccountMcpProvider,
  useUpdateOrganizationAccounts,
} from '@/platform/lib/data/credential-groups'

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
  const update = useUpdateOrganizationAccounts()
  const addMcp = useAddOrganizationAccountMcpProvider()
  const removeMcp = useRemoveOrganizationAccountMcpProvider()
  const pending = update.isPending || addMcp.isPending || removeMcp.isPending
  const options = getOrganizationAccountUpdateOptions(group)
  const error = update.error ?? addMcp.error ?? removeMcp.error

  function resetMutations() {
    update.reset()
    addMcp.reset()
    removeMcp.reset()
  }

  function updateConfigurations() {
    if (pending) return
    update.mutate(
      { organizationId, groupId: group.id, update: { options } },
      {
        onSuccess: () => toast.success('Provider configurations updated'),
        onError: (failure) => toast.error(failure.message),
      }
    )
  }

  function addProvider(choice: OrganizationAccountProviderChoice) {
    if (choice.kind === 'mcp') {
      if (choice.connectorId === 'databricks') {
        setCatalogOpen(false)
        setDatabricksOpen(true)
        return
      }
      addMcp.mutate(
        { organizationId, connectorId: choice.connectorId },
        {
          onSuccess: () => {
            setCatalogOpen(false)
            toast.success(`${MANAGED_MCP_CONNECTORS[choice.connectorId].name} added`)
          },
        }
      )
      return
    }
    const { provider } = choice
    if (provider === 'slack') {
      setCatalogOpen(false)
      setSlackOpen(true)
      return
    }
    const service = getCredentialGroupProviderService(provider)
    update.mutate(
      {
        organizationId,
        groupId: group.id,
        update: { options: [...options, { provider, label: service.name, required: false }] },
      },
      {
        onSuccess: () => {
          setCatalogOpen(false)
          toast.success(`${service.name} added`)
        },
      }
    )
  }

  async function removeProvider() {
    if (!removing || pending) return false
    if (removing.kind === 'mcp')
      await removeMcp.mutateAsync({ organizationId, connectorId: removing.connectorId })
    else
      await update.mutateAsync({
        organizationId,
        groupId: group.id,
        update: { options: options.filter((option) => option.provider !== removing.provider) },
      })
    toast.success('Provider removed')
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
          <SearchField
            label='Search providers'
            placeholder='Search providers…'
            value={searchTerm}
            onValueChange={setSearchTerm}
          />
        }
      >
        <Button
          variant='primary'
          size='compact'
          icon='I074'
          disabled={pending}
          onClick={() => {
            resetMutations()
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
                        resetMutations()
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
        {options.length > 0 && (
          <SettingsRow
            label='Provider configurations'
            description='Apply the current app configuration. Accounts whose app configuration changed will need to reconnect.'
          >
            <Button size='compact' disabled={pending} onClick={updateConfigurations}>
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
