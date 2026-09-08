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
} from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import type {
  OrganizationAccountsSettings,
  UpdateOrganizationAccountsBody,
} from '@/lib/api/contracts/organization-accounts'
import { getManagedMcpConnectorIcon } from '@/lib/credential-groups/managed-mcp-connector-icons'
import { MANAGED_MCP_CONNECTORS } from '@/lib/credential-groups/managed-mcp-connectors'
import {
  type CredentialGroupProvider,
  getCredentialGroupProviderService,
} from '@/lib/credential-groups/providers'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { DatabricksMcpConnectorModal } from '@/ee/credential-groups/components/databricks-mcp-connector-modal'
import {
  OrganizationAccountProviderCatalog,
  type OrganizationAccountProviderChoice,
} from '@/ee/credential-groups/components/organization-account-provider-catalog'
import { SlackManagedUsersModal } from '@/ee/credential-groups/components/slack-managed-users-modal'
import {
  useAddOrganizationAccountMcpProvider,
  useRemoveOrganizationAccountMcpProvider,
  useUpdateOrganizationAccounts,
} from '@/hooks/queries/organization-accounts'

interface OrganizationAccountProvidersProps {
  organizationId: string
  group: NonNullable<OrganizationAccountsSettings['credentialGroup']>
  availableProviders: CredentialGroupProvider[]
}

export function OrganizationAccountProviders({
  organizationId,
  group,
  availableProviders,
}: OrganizationAccountProvidersProps) {
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [removing, setRemoving] = useState<OrganizationAccountProviderChoice | null>(null)
  const [slackOpen, setSlackOpen] = useState(false)
  const [databricksOpen, setDatabricksOpen] = useState(false)
  const update = useUpdateOrganizationAccounts()
  const addMcp = useAddOrganizationAccountMcpProvider()
  const removeMcp = useRemoveOrganizationAccountMcpProvider()
  const pending = update.isPending || addMcp.isPending || removeMcp.isPending
  const options: NonNullable<UpdateOrganizationAccountsBody['options']> = group.options.map(
    (option) => {
      const common = { id: option.id, label: option.label, required: option.required }
      return option.provider === 'slack'
        ? { ...common, provider: 'slack', requiredScopes: option.requiredScopes }
        : { ...common, provider: option.provider }
    }
  )
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
  const rows = [
    ...group.options.map((option) => {
      const service = getCredentialGroupProviderService(option.provider)
      return {
        id: option.id,
        name: service.name,
        icon: service.icon,
        configure: option.provider === 'slack' ? () => setSlackOpen(true) : undefined,
        choice: { kind: 'oauth', provider: option.provider } as const,
      }
    }),
    ...group.mcpServers
      .filter((server) => server.managedConnectorId !== 'databricks' || server.enabled)
      .map((server) => ({
        id: server.id,
        name: MANAGED_MCP_CONNECTORS[server.managedConnectorId].name,
        icon: getManagedMcpConnectorIcon(server.managedConnectorId),
        configure:
          server.managedConnectorId === 'databricks' ? () => setDatabricksOpen(true) : undefined,
        choice: { kind: 'mcp', connectorId: server.managedConnectorId } as const,
      })),
  ].sort((left, right) => left.name.localeCompare(right.name))
  const error = update.error ?? addMcp.error ?? removeMcp.error
  const removingName = removing
    ? removing.kind === 'oauth'
      ? getCredentialGroupProviderService(removing.provider).name
      : MANAGED_MCP_CONNECTORS[removing.connectorId].name
    : ''

  return (
    <div className='flex flex-col gap-7'>
      <SettingsSection
        label='Providers'
        action={
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
            Add provider
          </Chip>
        }
      >
        <div className={RESOURCE_LIST_STACK}>
          {rows.map(({ id, name, icon: Icon, configure, choice }) => (
            <SettingsResourceRow
              key={id}
              icon={<Icon aria-hidden />}
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
          {!rows.length && (
            <SettingsEmptyState variant='inline'>
              Add a provider to start connecting accounts.
            </SettingsEmptyState>
          )}
        </div>
      </SettingsSection>
      {catalogOpen && (
        <OrganizationAccountProviderCatalog
          group={group}
          availableProviders={availableProviders}
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
    </div>
  )
}
