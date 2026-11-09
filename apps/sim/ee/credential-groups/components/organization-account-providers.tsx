'use client'

import { useState } from 'react'
import {
  Chip,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalFooter,
  ChipModalHeader,
  toast,
} from '@sim/emcn-legacy'
import { Plus } from '@sim/emcn-legacy/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryState } from 'nuqs'
import { RowActionsMenu } from '@/components/settings/primitives/row-actions-menu'
import { SettingsEmptyState } from '@/components/settings/primitives/settings-empty-state'
import { SettingsPanel } from '@/components/settings/primitives/settings-panel'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/components/settings/primitives/settings-resource-row'
import { SettingsSection } from '@/components/settings/primitives/settings-section/settings-section'
import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'
import {
  MANAGED_MCP_CONNECTORS,
  type ManagedMcpConnectorId,
} from '@/lib/credential-groups/managed-mcp-connectors'
import { getOrganizationAccountUpdateOptions } from '@/lib/credential-groups/organization-account-options'
import {
  type CredentialGroupProvider,
  getCredentialGroupProviderService,
} from '@/lib/credential-groups/providers'
import {
  credentialGroupProviderSearchParam,
  credentialGroupProviderSearchUrlKeys,
} from '@/lib/settings/search-params'
import { CredentialGroupProviderTile } from '@/ee/credential-groups/components/credential-group-provider-tile'
import { DatabricksMcpConnectorModal } from '@/ee/credential-groups/components/databricks-mcp-connector-modal'
import { OrganizationAccountProviderCatalog } from '@/ee/credential-groups/components/organization-account-provider-catalog'
import { SlackManagedUsersModal } from '@/ee/credential-groups/components/slack-managed-users-modal'
import {
  type OrganizationAccountProviderChoice,
  organizationAccountProviderRows,
} from '@/ee/credential-groups/provider-rows'
import {
  useAddOrganizationAccountMcpProvider,
  useRemoveOrganizationAccountMcpProvider,
  useUpdateOrganizationAccounts,
} from '@/hooks/queries/organization-accounts'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'

interface OrganizationAccountProvidersProps {
  organizationId: string
  group: NonNullable<OrganizationAccountsSettings['credentialGroup']>
  availableProviders: CredentialGroupProvider[]
  availableMcpConnectors?: readonly ManagedMcpConnectorId[]
  visibleProviders?: readonly CredentialGroupProvider[]
}

export function OrganizationAccountProviders({
  organizationId,
  group,
  availableProviders,
  availableMcpConnectors,
  visibleProviders,
}: OrganizationAccountProvidersProps) {
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
  const updateConfigurations = () => {
    if (pending) return
    update.mutate(
      { organizationId, groupId: group.id, update: { options } },
      {
        onSuccess: () => toast.success('Provider configurations updated'),
        onError: (error) => toast.error(error.message),
      }
    )
  }
  const addProvider = (choice: OrganizationAccountProviderChoice) => {
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
  const removeProvider = () => {
    if (!removing || pending) return
    const onSuccess = () => {
      setRemoving(null)
      toast.success('Provider removed')
    }
    if (removing.kind === 'mcp') {
      removeMcp.mutate({ organizationId, connectorId: removing.connectorId }, { onSuccess })
    } else {
      update.mutate(
        {
          organizationId,
          groupId: group.id,
          update: { options: options.filter((option) => option.provider !== removing.provider) },
        },
        { onSuccess }
      )
    }
  }
  const rows = organizationAccountProviderRows(group, visibleProviders).map((row) => ({
    ...row,
    configure:
      row.choice.kind === 'oauth'
        ? row.choice.provider === 'slack'
          ? () => setSlackOpen(true)
          : undefined
        : row.choice.connectorId === 'databricks'
          ? () => setDatabricksOpen(true)
          : undefined,
  }))
  const normalizedSearch = searchTerm.trim().toLowerCase()
  const visibleRows = rows.filter((row) => row.name.toLowerCase().includes(normalizedSearch))
  const error = update.error ?? addMcp.error ?? removeMcp.error
  const removingName = removing
    ? removing.kind === 'oauth'
      ? getCredentialGroupProviderService(removing.provider).name
      : MANAGED_MCP_CONNECTORS[removing.connectorId].name
    : ''

  return (
    <SettingsPanel
      search={{ value: searchTerm, onChange: setSearchTerm, placeholder: 'Search integrations...' }}
    >
      <SettingsSection
        label='Integrations'
        action={
          <div className='flex flex-wrap gap-2'>
            {options.length > 0 && (
              <Chip disabled={pending} onClick={updateConfigurations}>
                Update configurations
              </Chip>
            )}
            <Chip
              leftAdornment={<Plus className='size-[14px]' />}
              disabled={pending}
              onClick={() => {
                update.reset()
                addMcp.reset()
                removeMcp.reset()
                setCatalogOpen(true)
              }}
            >
              Add integration
            </Chip>
          </div>
        }
      >
        {options.length > 0 && (
          <p className='mb-3 text-[var(--text-muted)] text-small'>
            Apply the current app configuration. Accounts whose app configuration changed will need
            to reconnect.
          </p>
        )}
        <div className={RESOURCE_LIST_STACK}>
          {visibleRows.map(({ id, name, icon: Icon, configure, choice }) => (
            <SettingsResourceRow
              key={id}
              iconVariant='custom'
              icon={
                <CredentialGroupProviderTile
                  provider={choice.kind === 'oauth' ? choice.provider : choice.connectorId}
                  icon={Icon}
                />
              }
              title={name}
              trailing={
                <div className='flex items-center gap-2'>
                  {configure && (
                    <Chip disabled={pending} onClick={configure}>
                      Configure
                    </Chip>
                  )}
                  <RowActionsMenu
                    label={`${name} actions`}
                    actions={[
                      {
                        label: 'Remove',
                        destructive: true,
                        disabled: pending,
                        onSelect: () => {
                          update.reset()
                          addMcp.reset()
                          removeMcp.reset()
                          setRemoving(choice)
                        },
                      },
                    ]}
                  />
                </div>
              }
            />
          ))}
          {!visibleRows.length && (
            <SettingsEmptyState variant='inline'>
              {normalizedSearch
                ? 'No integrations match your search'
                : 'Add an integration to start connecting accounts.'}
            </SettingsEmptyState>
          )}
        </div>
      </SettingsSection>
      {catalogOpen && (
        <OrganizationAccountProviderCatalog
          group={group}
          availableProviders={availableProviders}
          availableMcpConnectors={availableMcpConnectors}
          pending={pending}
          error={error ? getErrorMessage(error) : undefined}
          onClose={() => setCatalogOpen(false)}
          onAdd={addProvider}
        />
      )}
      {databricksOpen && (
        <DatabricksMcpConnectorModal
          key={organizationId}
          open
          organizationId={organizationId}
          existingServer={group.mcpServers.find(
            (server) => server.managedConnectorId === 'databricks'
          )}
          onOpenChange={setDatabricksOpen}
        />
      )}
      {slackOpen && (
        <SlackManagedUsersModal
          open
          organizationId={organizationId}
          credentialGroupId={group.id}
          bots={[]}
          isLoading={false}
          error={null}
          onOpenChange={setSlackOpen}
          initialRequiredScopes={
            group.options.find((option) => option.provider === 'slack')?.requiredScopes
          }
        />
      )}
      {removing && (
        <ChipModal
          open
          size='sm'
          srTitle={`Remove ${removingName}`}
          dismissDisabled={pending}
          onOpenChange={(open) => {
            if (!open && !pending) setRemoving(null)
          }}
        >
          <ChipModalHeader onClose={() => setRemoving(null)} closeDisabled={pending}>
            Remove {removingName}
          </ChipModalHeader>
          <ChipModalBody>
            <p className='px-2 text-[var(--text-body)] text-sm'>
              Remove this provider and its connected accounts from the organization?
            </p>
            <ChipModalError>{error ? getErrorMessage(error) : null}</ChipModalError>
          </ChipModalBody>
          <ChipModalFooter
            defaultAction='none'
            onCancel={() => setRemoving(null)}
            cancelDisabled={pending}
            primaryAction={{
              label: pending ? 'Removing…' : 'Remove',
              variant: 'destructive',
              disabled: pending,
              onClick: removeProvider,
            }}
          />
        </ChipModal>
      )}
    </SettingsPanel>
  )
}
