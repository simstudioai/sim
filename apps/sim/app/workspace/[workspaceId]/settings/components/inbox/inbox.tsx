'use client'

import { ArrowRight } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/emcn'
import { getPlanTierCredits, isEnterprise } from '@/lib/billing/plan-helpers'
import { InboxEnableToggle } from '@/app/workspace/[workspaceId]/settings/components/inbox/inbox-enable-toggle'
import { InboxSettingsTab } from '@/app/workspace/[workspaceId]/settings/components/inbox/inbox-settings-tab'
import { InboxSkeleton } from '@/app/workspace/[workspaceId]/settings/components/inbox/inbox-skeleton'
import { InboxTaskList } from '@/app/workspace/[workspaceId]/settings/components/inbox/inbox-task-list'
import { isBillingEnabled } from '@/app/workspace/[workspaceId]/settings/navigation'
import { useInboxConfig } from '@/hooks/queries/inbox'
import { useSubscriptionData } from '@/hooks/queries/subscription'

export function Inbox() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string

  const { data: config, isLoading } = useInboxConfig(workspaceId)
  const { data: subscriptionResponse, isLoading: isSubLoading } = useSubscriptionData({
    enabled: isBillingEnabled,
  })

  const plan = subscriptionResponse?.data?.plan ?? null
  const isMaxPlan = getPlanTierCredits(plan) >= 25000 || isEnterprise(plan)

  if (isLoading || (isBillingEnabled && isSubLoading)) {
    return <InboxSkeleton />
  }

  if (isBillingEnabled && !isMaxPlan) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-[16px] py-[80px]'>
        <div className='text-center'>
          <h3 className='font-medium text-[16px] text-[var(--text-primary)]'>
            Sim Mailer requires a Max plan
          </h3>
          <p className='mt-[6px] text-[14px] text-[var(--text-muted)]'>
            Upgrade to Max to receive tasks via email and let Sim work on your behalf.
          </p>
        </div>
        <Button
          variant='primary'
          onClick={() => router.push(`/workspace/${workspaceId}/settings/subscription`)}
        >
          Upgrade to Max
          <ArrowRight className='ml-[6px] h-[14px] w-[14px]' />
        </Button>
      </div>
    )
  }

  return (
    <div className='flex h-full flex-col gap-[18px]'>
      <InboxEnableToggle />

      {config?.enabled && (
        <>
          <div className='border-[var(--border)] border-t' />
          <InboxSettingsTab />

          <div className='border-[var(--border)] border-t pt-[16px]'>
            <div className='font-medium text-[14px] text-[var(--text-secondary)]'>Inbox</div>
            <p className='mt-[2px] text-[13px] text-[var(--text-muted)]'>
              Email tasks received by this workspace.
            </p>
          </div>
          <InboxTaskList />
        </>
      )}
    </div>
  )
}
