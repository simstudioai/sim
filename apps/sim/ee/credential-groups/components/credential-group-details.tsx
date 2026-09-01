'use client'

import { useState } from 'react'
import { Chip, ChipConfirmModal, ChipInput, ChipTag, ChipTextarea, toast } from '@sim/emcn'
import { Search } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import type { WorkspaceCredential } from '@/lib/api/contracts'
import type {
  CredentialGroup,
  CredentialGroupOption,
  UpdateCredentialGroupBody,
} from '@/lib/api/contracts/credential-groups'
import {
  CREDENTIAL_GROUP_PROVIDER_IDS,
  type CredentialGroupApiKeyProvider,
  type CredentialGroupProvider,
  type CredentialGroupStandardOAuthProvider,
  getCredentialGroupProviderPresentation,
  getCredentialGroupProviderSupport,
  isCredentialGroupApiKeyProvider,
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

/** Stable identity so a pending/errored credentials query cannot churn the modal's `bots` prop. */
const EMPTY_SLACK_BOTS: WorkspaceCredential[] = []

interface CredentialGroupDetailsProps {
  credentialGroup: CredentialGroup
  workspaceId: string
  /** Filters the account types offered below; owned by the panel header's search field. */
  providerSearch: string
  onProviderSearchChange: (value: string) => void
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
    label: getCredentialGroupProviderPresentation(option.provider).name,
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
  onProviderSearchChange,
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

  const addProvider = async (
    provider: CredentialGroupStandardOAuthProvider | CredentialGroupApiKeyProvider
  ) => {
    const service = getCredentialGroupProviderPresentation(provider)
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
    if (
      isCredentialGroupStandardOAuthProvider(provider) ||
      isCredentialGroupApiKeyProvider(provider)
    ) {
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
    const service = getCredentialGroupProviderPresentation(removingProvider)
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
    return getCredentialGroupProviderPresentation(provider)
      .name.toLowerCase()
      .includes(providerQuery)
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
        <ChipInput
          icon={Search}
          className='mb-3 w-full'
          placeholder='Search account types...'
          aria-label='Search account types'
          value={providerSearch}
          onChange={(event) => onProviderSearchChange(event.target.value)}
        />
        {shownProviders.length === 0 ? (
          <SettingsEmptyState variant='inline'>
            {providerSearch.trim()
              ? `No account types found matching "${providerSearch}"`
              : 'No account types are available. Configure an OAuth client to offer one.'}
          </SettingsEmptyState>
        ) : null}
        <div className={RESOURCE_LIST_STACK}>
          {shownProviders.map((provider) => {
            const service = getCredentialGroupProviderPresentation(provider)
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
                      {/* Only Slack configures anything here — it collects a custom bot's
                          credentials before anyone can enroll. Every other kind, OAuth and
                          API key alike, is just added to the group. */}
                      {support.configuration === 'slack_custom_bot' ? 'Set up' : 'Add'}
                    </Chip>
                  )
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
          removingProvider
            ? getCredentialGroupProviderPresentation(removingProvider).name
            : 'account'
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
