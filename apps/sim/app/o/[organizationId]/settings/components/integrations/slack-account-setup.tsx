'use client'

import { useEffect } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import { useQueryState } from 'nuqs'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { connectedAccountsParam } from '@/app/o/[organizationId]/settings/components/integrations/search-params'
import {
  searchSetupParam,
  searchSetupReturnParam,
} from '@/app/workspace/[workspaceId]/search/search-params'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SlackManagedUsersModal } from '@/ee/credential-groups/components/slack-managed-users-modal'
import {
  useEnsureOrganizationAccounts,
  useOrganizationAccounts,
} from '@/hooks/queries/organization-accounts'

/** Slack's provider verification returns to the source form that started setup. */
export function OrganizationSlackAccountSetup() {
  const { organization, viewer } = useOrganizationContext()
  const [provider, setProvider] = useQueryState(
    connectedAccountsParam.key,
    connectedAccountsParam.parser.withOptions({ history: 'replace' })
  )
  const [returnSource, setReturnSource] = useQueryState(
    searchSetupReturnParam.key,
    searchSetupReturnParam.parser
  )
  const [, setSelectedType] = useQueryState(searchSetupParam.key, searchSetupParam.parser)
  const open = provider === 'slack' && viewer.isAdmin
  const accounts = useOrganizationAccounts(open ? organization.id : undefined)
  const {
    mutate: ensureAccounts,
    data: preparedAccounts,
    error: setupError,
    isIdle: setupIdle,
    isPending: setupPending,
  } = useEnsureOrganizationAccounts()
  const prepared = preparedAccounts?.credentialGroup
  const group =
    accounts.data?.credentialGroup ??
    (prepared?.organizationId === organization.id ? prepared : undefined)
  const needsSetup = open && accounts.isSuccess && !group
  useEffect(() => {
    if (needsSetup && setupIdle) ensureAccounts({ organizationId: organization.id })
  }, [ensureAccounts, needsSetup, setupIdle, organization.id])

  const close = () => {
    void setProvider(null)
    void setReturnSource(null, { history: 'replace' })
    if (returnSource)
      void setSelectedType(returnSource === 'search' ? null : returnSource, { history: 'replace' })
  }
  if (!open) return null
  if (group)
    return (
      <SlackManagedUsersModal
        open
        organizationId={organization.id}
        credentialGroupId={group.id}
        bots={[]}
        isLoading={false}
        error={null}
        initialCredentialId={
          group.options.find((option) => option.provider === 'slack')?.slackBotCredentialId ??
          undefined
        }
        initialRequiredScopes={
          group.options.find((option) => option.provider === 'slack')?.requiredScopes
        }
        onOpenChange={(next) => {
          if (!next) close()
        }}
      />
    )
  return (
    <ChipModal
      open
      onOpenChange={(next) => {
        if (!next) close()
      }}
      srTitle='Set up Slack'
    >
      <ChipModalHeader onClose={close}>Set up Slack</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField type='custom' title='Connected accounts'>
          {accounts.error || setupError ? (
            <SettingsQueryErrorState
              error={accounts.error ?? setupError}
              fallback='Could not load connected accounts'
              isRetrying={accounts.isFetching || setupPending}
              onRetry={() =>
                accounts.error
                  ? void accounts.refetch()
                  : ensureAccounts({ organizationId: organization.id })
              }
              variant='inline'
            />
          ) : (
            <SettingsEmptyState variant='inline'>Loading Slack setup…</SettingsEmptyState>
          )}
        </ChipModalField>
      </ChipModalBody>
      <ChipModalFooter onCancel={close} defaultAction='dismiss' />
    </ChipModal>
  )
}
