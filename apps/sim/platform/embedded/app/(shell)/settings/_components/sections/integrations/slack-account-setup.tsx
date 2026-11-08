'use client'

import { Modal } from '@sim/emcn/modal'
import { FailureNotice } from '@sim/emcn/status'
import { useQueryState } from 'nuqs'
import { searchSetupParam, searchSetupReturnParam } from '@/lib/sim-search/params'
import { connectedAccountsParam } from '@/app/o/[organizationId]/settings/components/integrations/search-params'
import { SlackMemberSetupModal } from '@/platform/embedded/app/(shell)/settings/_components/sections/connected-accounts/slack-member-setup-modal'
import { useSlackAppSetup } from '@/platform/embedded/lib/data/integrations'

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
  const { group, failure } = useSlackAppSetup(organizationId, open)

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
  if (!failure) return null
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
        message={failure.message}
        retrying={failure.retrying}
        onRetry={failure.retry}
      />
    </Modal>
  )
}
