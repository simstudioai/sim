'use client'

import { useState } from 'react'
import { Chip, ChipConfirmModal, ChipInput, ChipTag, ChipTextarea, toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
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
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { SettingRow } from '@/ee/components/setting-row'
import { SlackManagedUsersModal } from '@/ee/credential-groups/components/slack-managed-users-modal'
import { useUpdateCredentialGroup } from '@/hooks/queries/credential-groups'
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'

interface CredentialGroupDetailsProps {
  credentialGroup: CredentialGroup
  workspaceId: string
}

function toOptionUpdateInput(
  option: CredentialGroupOption
): NonNullable<UpdateCredentialGroupBody['options']>[number] {
  const common = {
    id: option.id,
    label: getCredentialGroupProviderService(option.provider).name,
    required: true,
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
}: CredentialGroupDetailsProps) {
  const updateGroup = useUpdateCredentialGroup()
  const slackBots = useWorkspaceCredentials({
    workspaceId,
    type: 'service_account',
    providerId: SLACK_CUSTOM_BOT_PROVIDER_ID,
  })
  const [name, setName] = useState(credentialGroup.name)
  const [description, setDescription] = useState(credentialGroup.description ?? '')
  const [slackSetupOpen, setSlackSetupOpen] = useState(false)
  const [slackSetupCredentialId, setSlackSetupCredentialId] = useState<string | undefined>()
  const [removingProvider, setRemovingProvider] = useState<CredentialGroupProvider | null>(null)

  const normalizedDescription = description.trim() || null
  const detailsDirty =
    name.trim() !== credentialGroup.name || normalizedDescription !== credentialGroup.description
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

  const addProvider = async (provider: CredentialGroupStandardOAuthProvider) => {
    const service = getCredentialGroupProviderService(provider)
    const existing = credentialGroup.options.map(toOptionUpdateInput)
    const nextOption: NonNullable<UpdateCredentialGroupBody['options']>[number] = {
      provider,
      label: service.name,
      required: true,
    }
    return updateOptions([...existing, nextOption], `${service.name} added`)
  }

  const openSlackSetup = (credentialId?: string) => {
    setSlackSetupCredentialId(credentialId)
    setSlackSetupOpen(true)
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

  const handleSaveDetails = async () => {
    if (!detailsDirty || !name.trim() || isUpdating) return
    try {
      await updateGroup.mutateAsync({
        workspaceId,
        groupId: credentialGroup.id,
        body: { name: name.trim(), description: normalizedDescription },
      })
      toast.success('Details saved')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not save details'))
    }
  }

  const handleRemoveProvider = async () => {
    if (!removingProvider) return
    const service = getCredentialGroupProviderService(removingProvider)
    const options = credentialGroup.options
      .filter((option) => option.provider !== removingProvider)
      .map(toOptionUpdateInput)
    if (await updateOptions(options, `${service.name} removed`)) setRemovingProvider(null)
  }

  return (
    <>
      <div className='flex flex-col gap-7'>
        <SettingsSection
          label='Group details'
          action={
            detailsDirty ? (
              <Chip
                variant='primary'
                onClick={() => void handleSaveDetails()}
                disabled={!name.trim() || isUpdating}
              >
                {isUpdating ? 'Saving...' : 'Save changes'}
              </Chip>
            ) : undefined
          }
        >
          <div className='flex max-w-[560px] flex-col gap-4'>
            <SettingRow label='Name' htmlFor='credential-group-name'>
              <ChipInput
                id='credential-group-name'
                value={name}
                onChange={(event) => setName(event.target.value)}
                error={!name.trim()}
              />
            </SettingRow>
            <SettingRow label='Description' optional htmlFor='credential-group-description'>
              <ChipTextarea
                id='credential-group-description'
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder='What these accounts will be used for'
                rows={3}
              />
            </SettingRow>
          </div>
        </SettingsSection>

        <SettingsSection label='Accounts people can connect'>
          <div className={RESOURCE_LIST_STACK}>
            {CREDENTIAL_GROUP_PROVIDER_IDS.map((provider) => {
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
      </div>

      <SlackManagedUsersModal
        open={slackSetupOpen}
        workspaceId={workspaceId}
        credentialGroupId={credentialGroup.id}
        onOpenChange={(nextOpen) => {
          setSlackSetupOpen(nextOpen)
          if (!nextOpen) setSlackSetupCredentialId(undefined)
        }}
        bots={slackBots.data ?? []}
        isLoading={slackBots.isPending}
        error={slackBots.error}
        initialCredentialId={slackSetupCredentialId}
      />

      <ChipConfirmModal
        open={Boolean(removingProvider)}
        onOpenChange={(open) => !open && !isUpdating && setRemovingProvider(null)}
        srTitle='Remove account type'
        title={`Remove ${
          removingProvider ? getCredentialGroupProviderService(removingProvider).name : 'account'
        }`}
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
