'use client'

import { useState } from 'react'
import { Chip, ChipConfirmModal, ChipInput, ChipTag, ChipTextarea, toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { McpIcon } from '@/components/icons'
import type { WorkspaceCredential } from '@/lib/api/contracts'
import type {
  CredentialGroup,
  CredentialGroupOption,
  UpdateCredentialGroupBody,
} from '@/lib/api/contracts/credential-groups'
import {
  CREDENTIAL_GROUP_PROVIDER_IDS,
  type CredentialGroupProvider,
  type CredentialGroupStandardOAuthProvider,
  getCredentialGroupProviderService,
  getCredentialGroupProviderSupport,
  isCredentialGroupStandardOAuthProvider,
} from '@/lib/credential-groups/providers'
import { SLACK_CUSTOM_BOT_PROVIDER_ID } from '@/lib/oauth/types'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { SettingRow } from '@/ee/components/setting-row'
import { SlackManagedUsersModal } from '@/ee/credential-groups/components/slack-managed-users-modal'
import { useCredentialGroups, useUpdateCredentialGroup } from '@/hooks/queries/credential-groups'
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'
import { useMcpServers } from '@/hooks/queries/mcp'

/** Stable identity so a pending/errored credentials query cannot churn the modal's `bots` prop. */
const EMPTY_SLACK_BOTS: WorkspaceCredential[] = []

interface CredentialGroupDetailsProps {
  credentialGroup: CredentialGroup
  workspaceId: string
  /** Filters the account types offered below; owned by the panel header's search field. */
  providerSearch: string
  /** Edited name; committed by the panel header's Save action, which owns the dirty state. */
  name: string
  onNameChange: (name: string) => void
  description: string
  onDescriptionChange: (description: string) => void
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
  name,
  onNameChange,
  description,
  onDescriptionChange,
}: CredentialGroupDetailsProps) {
  const updateGroup = useUpdateCredentialGroup()
  /**
   * Reads the same cache entry the list view already populated, so the deployment's configured
   * providers arrive without a second request.
   */
  const credentialGroups = useCredentialGroups(workspaceId)
  const availableProviders = credentialGroups.data?.availableProviders
  const mcpServers = useMcpServers(workspaceId)
  const slackBots = useWorkspaceCredentials({
    workspaceId,
    type: 'service_account',
    providerId: SLACK_CUSTOM_BOT_PROVIDER_ID,
  })
  const [slackSetup, setSlackSetup] = useState<{ credentialId?: string } | null>(null)
  const [removingProvider, setRemovingProvider] = useState<CredentialGroupProvider | null>(null)

  const isUpdating = updateGroup.isPending

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
      toast.error(getErrorMessage(error, 'Could not update account collection'))
      return false
    }
  }

  const updateMcpServers = async (mcpServerIds: string[], successMessage: string) => {
    try {
      await updateGroup.mutateAsync({
        workspaceId,
        groupId: credentialGroup.id,
        body: { mcpServerIds },
      })
      toast.success(successMessage)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not update MCP servers'))
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
  const linkedMcpServerIds = new Set(credentialGroup.mcpServers.map((server) => server.id))
  const mcpOwnershipReady = credentialGroups.isSuccess
  const mcpServerOwnerById = new Map(
    credentialGroups.data?.credentialGroups.flatMap((group) =>
      group.mcpServers.map((server) => [server.id, group] as const)
    ) ?? []
  )
  const shownMcpServers = (mcpServers.data ?? []).filter((server) => {
    const linked = linkedMcpServerIds.has(server.id)
    if (!linked && (server.authType !== 'oauth' || !server.enabled || server.deletedAt))
      return false
    if (!providerQuery) return true
    return (
      server.name.toLowerCase().includes(providerQuery) ||
      server.description?.toLowerCase().includes(providerQuery)
    )
  })

  return (
    <>
      <SettingsSection label='Group details'>
        <div className='flex flex-col gap-4'>
          <SettingRow
            label='Name'
            htmlFor='credential-group-name'
            error={name.trim() ? undefined : 'Name is required.'}
          >
            <ChipInput
              id='credential-group-name'
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              error={!name.trim()}
            />
          </SettingRow>
          <SettingRow label='Description' optional htmlFor='credential-group-description'>
            <ChipTextarea
              id='credential-group-description'
              value={description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              placeholder='What these accounts will be used for'
              rows={3}
            />
          </SettingRow>
        </div>
      </SettingsSection>

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
                  ? `${slackBot.displayName}${slackNeedsSetup ? ' needs managed-user setup' : ''}`
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
                  option && !slackNeedsSetup ? (
                    <ChipTag variant='gray'>Connected</ChipTag>
                  ) : undefined
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

      <SettingsSection label='MCP servers people can connect'>
        {mcpServers.isPending ? (
          <SettingsEmptyState variant='inline'>Loading OAuth MCP servers...</SettingsEmptyState>
        ) : shownMcpServers.length === 0 ? (
          <SettingsEmptyState variant='inline'>
            {providerSearch.trim()
              ? `No OAuth MCP servers found matching "${providerSearch}"`
              : 'No OAuth MCP servers are available. Add one in MCP settings first.'}
          </SettingsEmptyState>
        ) : null}
        <div className={RESOURCE_LIST_STACK}>
          {shownMcpServers.map((server) => {
            const linked = linkedMcpServerIds.has(server.id)
            const owner = mcpServerOwnerById.get(server.id)
            const assignedElsewhere = owner && owner.id !== credentialGroup.id
            return (
              <SettingsResourceRow
                key={server.id}
                icon={<McpIcon aria-hidden />}
                title={server.name}
                description={
                  assignedElsewhere
                    ? `Used by ${owner.name}`
                    : server.description || 'Each invited person connects their own OAuth account'
                }
                badge={
                  linked ? (
                    <ChipTag variant='gray'>Added</ChipTag>
                  ) : assignedElsewhere ? (
                    <ChipTag variant='gray'>Unavailable</ChipTag>
                  ) : undefined
                }
                trailing={
                  <Chip
                    disabled={isUpdating || !mcpOwnershipReady || Boolean(assignedElsewhere)}
                    onClick={() =>
                      void updateMcpServers(
                        linked
                          ? credentialGroup.mcpServers
                              .filter((candidate) => candidate.id !== server.id)
                              .map((candidate) => candidate.id)
                          : [
                              ...credentialGroup.mcpServers.map((candidate) => candidate.id),
                              server.id,
                            ],
                        linked ? `${server.name} removed` : `${server.name} added`
                      )
                    }
                  >
                    {linked ? 'Remove' : 'Add'}
                  </Chip>
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
      />

      <ChipConfirmModal
        open={Boolean(removingProvider)}
        onOpenChange={(open) => !open && !isUpdating && setRemovingProvider(null)}
        srTitle='Remove account type'
        title={`Remove ${
          removingProvider ? getCredentialGroupProviderService(removingProvider).name : 'account'
        }`}
        defaultAction='confirm'
        text='People will no longer be asked to connect this account. Existing credentials are retained but will no longer be returned by this group.'
        dismissLabel='Cancel'
        confirm={{
          label: isUpdating ? 'Removing...' : 'Remove',
          onClick: handleRemoveProvider,
          disabled: isUpdating,
        }}
      />
    </>
  )
}
