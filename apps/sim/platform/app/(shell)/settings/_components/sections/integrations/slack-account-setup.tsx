'use client'

import { useEffect } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryState } from 'nuqs'
import { SlackMemberSetupModal } from '@/platform/app/(shell)/settings/_components/sections/connected-accounts/slack-member-setup-modal'
import { FailureNotice, Modal } from '@/platform/design-system/components'
import {
  connectedAccountsParam,
  searchSetupParam,
  searchSetupReturnParam,
  useEnsureOrganizationAccounts,
  useOrganizationAccounts,
} from '@/platform/lib/data/sources'

interface SlackAccountSetupProps {
  organizationId: string
  isAdmin: boolean
}

/** Slack's provider verification returns to the source form that started setup. */
export function SlackAccountSetup({ organizationId, isAdmin }: SlackAccountSetupProps) {
  const [provider, setProvider] = useQueryState(
    connectedAccountsParam.key,
    connectedAccountsParam.parser.withOptions({ history: 'replace' })
  )
  const [returnSource, setReturnSource] = useQueryState(
    searchSetupReturnParam.key,
    searchSetupReturnParam.parser
  )
  const [, setSelectedType] = useQueryState(searchSetupParam.key, searchSetupParam.parser)
  const open = provider === 'slack' && isAdmin
  const accounts = useOrganizationAccounts(open ? organizationId : undefined)
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
    (prepared?.organizationId === organizationId ? prepared : undefined)
  const needsSetup = open && accounts.isSuccess && !group
  useEffect(() => {
    if (needsSetup && setupIdle) ensureAccounts({ organizationId })
  }, [ensureAccounts, needsSetup, setupIdle, organizationId])

  const close = () => {
    void setProvider(null)
    void setReturnSource(null, { history: 'replace' })
    if (returnSource)
      void setSelectedType(returnSource === 'search' ? null : returnSource, { history: 'replace' })
  }
  if (!open) return null
  if (group) {
    const option = group.options.find((item) => item.provider === 'slack')
    return (
      <SlackMemberSetupModal
        organizationId={organizationId}
        credentialGroupId={group.id}
        initialCredentialId={option?.slackBotCredentialId ?? undefined}
        initialRequiredScopes={option?.requiredScopes}
        onOpenChange={(next) => {
          if (!next) close()
        }}
      />
    )
  }
  const error = accounts.error ?? setupError
  if (!error) return null
  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) close()
      }}
      title='Set up Slack app'
      cancelLabel='Close'
      confirmLabel='Done'
    >
      <FailureNotice
        message={getErrorMessage(error, 'Could not load Slack setup')}
        retrying={accounts.isFetching || setupPending}
        onRetry={() =>
          accounts.error ? void accounts.refetch() : ensureAccounts({ organizationId })
        }
      />
    </Modal>
  )
}
