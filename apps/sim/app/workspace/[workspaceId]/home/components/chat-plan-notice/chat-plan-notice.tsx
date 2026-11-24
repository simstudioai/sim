'use client'

import { useRouter } from 'next/navigation'
import { CHAT_PLAN_REQUIRED_UPGRADE } from '@/lib/billing/chat-plan'
import { PRO_TRIAL_DAYS } from '@/lib/billing/constants'
import { rememberSettingsReturnUrl } from '@/lib/navigation/settings-return'
import { useChatPlanRequired } from '@/app/workspace/[workspaceId]/home/hooks/use-chat-plan-required'
import { usePlanUpgradeLink } from '@/app/workspace/[workspaceId]/home/hooks/use-plan-upgrade-link'
import { useWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { useSubscriptionData } from '@/hooks/queries/subscription'

/**
 * Says up front, above an empty composer, that this workspace's plan does not include Chat, so a
 * free payer learns it before typing rather than from the modal a send opens.
 */
export function ChatPlanNotice() {
  if (!useChatPlanRequired()) return null
  return <ChatPlanNoticeContent />
}

function ChatPlanNoticeContent() {
  const router = useRouter()
  const hostContext = useWorkspaceHostContext()
  const { href, opensInNewTab, canManageBilling, unavailableMessage } = usePlanUpgradeLink(
    CHAT_PLAN_REQUIRED_UPGRADE
  )
  const isPersonalWorkspace = !hostContext.hostOrganizationId
  // Only a personal checkout starts the trial, so the offer is the viewer's own.
  const { data: viewerBilling } = useSubscriptionData({
    enabled: canManageBilling && isPersonalWorkspace,
  })
  const offersTrial = isPersonalWorkspace && viewerBilling?.data?.proTrialEligible === true

  const openUpgrade = () => {
    if (opensInNewTab) {
      window.open(href, '_blank', 'noopener,noreferrer')
      return
    }
    rememberSettingsReturnUrl(href)
    router.push(href)
  }

  return (
    <p className='mb-4 max-w-chat text-center text-[var(--text-muted)] text-small'>
      Chat with Sim is included with paid plans.{' '}
      {canManageBilling ? (
        <button
          type='button'
          onClick={openUpgrade}
          className='text-[var(--text-body)] underline underline-offset-2'
        >
          {offersTrial ? `Start a ${PRO_TRIAL_DAYS}-day free trial` : 'Upgrade your plan'}
        </button>
      ) : (
        unavailableMessage
      )}
    </p>
  )
}
