'use client'

import { useState } from 'react'
import { Chip, ChipConfirmModal, ChipTag, toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import type { WorkspaceCredential } from '@/lib/api/contracts'
import type {
  CredentialGroup,
  CredentialGroupOption,
  UpdateCredentialGroupBody,
} from '@/lib/api/contracts/credential-groups'
import { getManagedMcpConnectorIcon } from '@/lib/credential-groups/managed-mcp-connector-icons'
import {
  MANAGED_MCP_CONNECTOR_IDS,
  MANAGED_MCP_CONNECTORS,
  type ManagedMcpConnectorId,
} from '@/lib/credential-groups/managed-mcp-connectors'
import {
  CREDENTIAL_GROUP_PROVIDER_IDS,
  type CredentialGroupProvider,
  type CredentialGroupStandardOAuthProvider,
  getCredentialGroupProviderService,
  getCredentialGroupProviderSupport,
  isCredentialGroupStandardOAuthProvider,
} from '@/lib/credential-groups/providers'
import { SLACK_MANAGED_USER_SCOPES } from '@/lib/credential-groups/slack-managed-user-scopes'
import { SLACK_CUSTOM_BOT_PROVIDER_ID } from '@/lib/oauth/types'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { SlackManagedUsersModal } from '@/ee/credential-groups/components/slack-managed-users-modal'
import {
  useCreateCredentialGroupMcpConnector,
  useDeleteCredentialGroupMcpConnector,
  useUpdateCredentialGroup,
  useWorkspaceAccounts,
} from '@/hooks/queries/credential-groups'
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'

/** Stable identity so a pending/errored credentials query cannot churn the modal's `bots` prop. */
const EMPTY_SLACK_BOTS: WorkspaceCredential[] = []

interface CredentialGroupDetailsProps {
  credentialGroup: CredentialGroup
  workspaceId: string
  /** Filters the account types offered below; owned by the panel header's search field. */
  providerSearch: string
}

function toOptionUpdateInput(
  option: CredentialGroupOption
): NonNullable<UpdateCredentialGroupBody['options']>[number] {
  const common = {
    id: option.id,
    label: getCredentialGroupProviderService(option.provider).name,
    required: false,
  }
  if (option.provider !== 'slack') return { ...common, provider: option.provider }
  return {
    ...common,
    provider: 'slack',
    slackBotCredentialId: option.slackBotCredentialId,
  }
}

export function CredentialGroupDetails({
  credentialGroup,
  workspaceId,
  providerSearch,
}: CredentialGroupDetailsProps) {
  const updateGroup = useUpdateCredentialGroup()
  const createMcpConnector = useCreateCredentialGroupMcpConnector()
  const deleteMcpConnector = useDeleteCredentialGroupMcpConnector()
  /**
   * Reads the same cache entry the workspace settings already populated, so the deployment's configured
   * providers arrive without a second request.
   */
  const accounts = useWorkspaceAccounts(workspaceId)
  const availableProviders = accounts.data?.availableProviders
  const slackBots = useWorkspaceCredentials({
    workspaceId,
    type: 'service_account',
    providerId: SLACK_CUSTOM_BOT_PROVIDER_ID,
  })
  const [slackSetup, setSlackSetup] = useState<{ credentialId?: string } | null>(null)
  const [removingProvider, setRemovingProvider] = useState<CredentialGroupProvider | null>(null)
  const [removingMcpConnector, setRemovingMcpConnector] = useState<ManagedMcpConnectorId | null>(
    null
  )

  const isUpdating =
    updateGroup.isPending || createMcpConnector.isPending || deleteMcpConnector.isPending

  const updateOptions = async (
    options: NonNullable<UpdateCredentialGroupBody['options']>,
    successMessage: string
  ) => {
    try {
      await updateGroup.mutateAsync({
        workspaceId,
        groupId: credentialGroup.id,
        body: { options },
      })
      toast.success(successMessage)
      return true
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not update connected accounts'))
      return false
    }
  }

  const addProvider = async (provider: CredentialGroupStandardOAuthProvider) => {
    const service = getCredentialGroupProviderService(provider)
    const existing = credentialGroup.options.map(toOptionUpdateInput)
    const nextOption: NonNullable<UpdateCredentialGroupBody['options']>[number] = {
      provider,
      label: service.name,
      required: false,
    }
    return updateOptions([...existing, nextOption], `${service.name} added`)
  }

  const openSlackSetup = (credentialId?: string) => {
    setSlackSetup({ credentialId })
  }

  const handleProviderAction = (provider: CredentialGroupProvider) => {
    const support = getCredentialGroupProviderSupport(provider)
    if (isCredentialGroupStandardOAuthProvider(provider)) {
      void addProvider(provider)
      return
    }
    if (support.configuration === 'slack_custom_bot') {
      openSlackSetup()
      return
    }
    throw new Error(`Unsupported Credential Group configuration: ${support.configuration}`)
  }

  const handleRemoveProvider = async () => {
    if (!removingProvider) return
    const service = getCredentialGroupProviderService(removingProvider)
    const options = credentialGroup.options
      .filter((option) => option.provider !== removingProvider)
      .map(toOptionUpdateInput)
    if (await updateOptions(options, `${service.name} removed`)) setRemovingProvider(null)
  }

  const addMcpConnector = async (connectorId: Exclude<ManagedMcpConnectorId, 'databricks'>) => {
    try {
      await createMcpConnector.mutateAsync({
        workspaceId,
        groupId: credentialGroup.id,
        body: { connectorId },
      })
      toast.success(`${MANAGED_MCP_CONNECTORS[connectorId].name} added`)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not add MCP app'))
    }
  }

  const handleRemoveMcpConnector = async () => {
    if (!removingMcpConnector) return
    const connector = MANAGED_MCP_CONNECTORS[removingMcpConnector]
    try {
      await deleteMcpConnector.mutateAsync({
        workspaceId,
        groupId: credentialGroup.id,
        connectorId: removingMcpConnector,
      })
      toast.success(`${connector.name} removed`)
      setRemovingMcpConnector(null)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not remove MCP app'))
    }
  }

  /**
   * A provider whose OAuth client this deployment has not configured can never finish an
   * enrollment, so it is not offered — but one already on the group stays listed regardless, or
   * the row that removes it would disappear along with it.
   */
  const configuredProviders = new Set(credentialGroup.options.map((option) => option.provider))
  const offerableProviders = availableProviders ? new Set(availableProviders) : null
  const providerQuery = providerSearch.trim().toLowerCase()
  const shownProviders = CREDENTIAL_GROUP_PROVIDER_IDS.filter((provider) => {
    if (
      !configuredProviders.has(provider) &&
      offerableProviders &&
      !offerableProviders.has(provider)
    ) {
      return false
    }
    if (!providerQuery) return true
    return getCredentialGroupProviderService(provider).name.toLowerCase().includes(providerQuery)
  })
  const shownMcpConnectors = MANAGED_MCP_CONNECTOR_IDS.filter((connectorId) => {
    if (!providerQuery) return true
    const connector = MANAGED_MCP_CONNECTORS[connectorId]
    return (
      connector.name.toLowerCase().includes(providerQuery) ||
      connector.description.toLowerCase().includes(providerQuery)
    )
  })

  return (
    <>
      <SettingsSection label='Accounts people can connect'>
        {shownProviders.length === 0 ? (
          <SettingsEmptyState variant='inline'>
            {providerSearch.trim()
              ? `No account types found matching "${providerSearch}"`
              : 'No account types are available. Configure an OAuth client to offer one.'}
          </SettingsEmptyState>
        ) : null}
        <div className={RESOURCE_LIST_STACK}>
          {shownProviders.map((provider) => {
            const service = getCredentialGroupProviderService(provider)
            const support = getCredentialGroupProviderSupport(provider)
            const option = credentialGroup.options.find(
              (candidate) => candidate.provider === provider
            )
            const ProviderIcon = service.icon
            const slackBot =
              provider === 'slack' && option?.provider === 'slack'
                ? slackBots.data?.find((bot) => bot.id === option.slackBotCredentialId)
                : undefined
            const slackNeedsSetup =
              provider === 'slack' &&
              option?.provider === 'slack' &&
              (!slackBot || option.configurationStatus !== 'ready')
            const descriptionText =
              provider === 'slack' && option
                ? slackBot
                  ? `${slackBot.displayName}${slackNeedsSetup ? ' · Finish member sign-in setup' : ''}`
                  : slackBots.isPending
                    ? 'Loading custom Slack app...'
                    : 'Custom Slack app unavailable'
                : support.description

            return (
              <SettingsResourceRow
                key={provider}
                icon={<ProviderIcon aria-hidden />}
                title={service.name}
                description={descriptionText}
                badge={
                  option && !slackNeedsSetup ? <ChipTag variant='gray'>Added</ChipTag> : undefined
                }
                trailing={
                  option ? (
                    <div className='flex items-center gap-1'>
                      {slackNeedsSetup && option.provider === 'slack' && slackBot ? (
                        <Chip onClick={() => openSlackSetup(slackBot.id)} disabled={isUpdating}>
                          Continue setup
                        </Chip>
                      ) : null}
                      <RowActionsMenu
                        label={`${service.name} actions`}
                        actions={[
                          ...(provider === 'slack'
                            ? [
                                {
                                  label: 'Change Slack app',
                                  onSelect: () =>
                                    openSlackSetup(
                                      option?.provider === 'slack'
                                        ? option.slackBotCredentialId
                                        : undefined
                                    ),
                                  disabled: isUpdating,
                                },
                              ]
                            : []),
                          {
                            label: 'Remove',
                            destructive: true,
                            onSelect: () => setRemovingProvider(provider),
                            disabled: isUpdating,
                          },
                        ]}
                      />
                    </div>
                  ) : (
                    <Chip
                      onClick={() => handleProviderAction(provider)}
                      disabled={isUpdating || (provider === 'slack' && slackBots.isPending)}
                    >
                      {support.configuration === 'oauth' ? 'Add' : 'Set up'}
                    </Chip>
                  )
                }
              />
            )
          })}
        </div>
      </SettingsSection>

      <SettingsSection label='MCP apps people can connect'>
        {shownMcpConnectors.length === 0 ? (
          <SettingsEmptyState variant='inline'>
            {providerSearch.trim()
              ? `No MCP apps found matching "${providerSearch}"`
              : 'No MCP apps are available.'}
          </SettingsEmptyState>
        ) : null}
        <div className={RESOURCE_LIST_STACK}>
          {shownMcpConnectors.map((connectorId) => {
            const connector = MANAGED_MCP_CONNECTORS[connectorId]
            const server = credentialGroup.mcpServers.find(
              (candidate) => candidate.managedConnectorId === connectorId
            )
            const ConnectorIcon = getManagedMcpConnectorIcon(connectorId)
            return (
              <SettingsResourceRow
                key={connectorId}
                icon={<ConnectorIcon aria-hidden />}
                title={server?.name ?? connector.name}
                description={
                  connectorId === 'databricks'
                    ? 'Configure Databricks in organization Connected accounts'
                    : connector.description
                }
                badge={server ? <ChipTag variant='gray'>Added</ChipTag> : undefined}
                trailing={
                  server ? (
                    <RowActionsMenu
                      label={`${connector.name} actions`}
                      actions={[
                        {
                          label: 'Remove',
                          destructive: true,
                          onSelect: () => setRemovingMcpConnector(connectorId),
                          disabled: isUpdating,
                        },
                      ]}
                    />
                  ) : connectorId !== 'databricks' ? (
                    <Chip disabled={isUpdating} onClick={() => void addMcpConnector(connectorId)}>
                      Add
                    </Chip>
                  ) : undefined
                }
              />
            )
          })}
        </div>
      </SettingsSection>

      <SlackManagedUsersModal
        open={slackSetup !== null}
        workspaceId={workspaceId}
        credentialGroupId={credentialGroup.id}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setSlackSetup(null)
        }}
        bots={slackBots.data ?? EMPTY_SLACK_BOTS}
        isLoading={slackBots.isPending}
        error={slackBots.error}
        initialCredentialId={slackSetup?.credentialId}
        initialRequiredScopes={
          credentialGroup.options.find((option) => option.provider === 'slack')?.requiredScopes ??
          (credentialGroup.options.some((option) => option.provider === 'slack')
            ? SLACK_MANAGED_USER_SCOPES
            : undefined)
        }
      />

      <ChipConfirmModal
        open={Boolean(removingProvider)}
        onOpenChange={(open) => !open && !isUpdating && setRemovingProvider(null)}
        srTitle='Remove account type'
        title={`Remove ${
          removingProvider ? getCredentialGroupProviderService(removingProvider).name : 'account'
        }`}
        text='People will no longer be able to connect this account. Previously connected accounts will no longer be available to Search or workflows.'
        dismissLabel='Cancel'
        confirm={{
          label: isUpdating ? 'Removing...' : 'Remove',
          onClick: handleRemoveProvider,
          disabled: isUpdating,
        }}
      />

      <ChipConfirmModal
        open={Boolean(removingMcpConnector)}
        onOpenChange={(open) => !open && !isUpdating && setRemovingMcpConnector(null)}
        srTitle='Remove MCP app'
        title={`Remove ${
          removingMcpConnector ? MANAGED_MCP_CONNECTORS[removingMcpConnector].name : 'MCP app'
        }`}
        text='People will no longer be able to connect this app. Existing OAuth grants and saved tool metadata will be revoked.'
        dismissLabel='Cancel'
        confirm={{
          label: isUpdating ? 'Removing...' : 'Remove',
          onClick: handleRemoveMcpConnector,
          disabled: isUpdating,
        }}
      />
    </>
  )
}
