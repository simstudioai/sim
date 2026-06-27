'use client'

import { ArrowRight } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Chip } from '@/components/emcn'
import { getSubscriptionAccessState } from '@/lib/billing/client'
import {
  InboxEnableToggle,
  InboxSettingsTab,
  InboxTaskList,
} from '@/app/workspace/[workspaceId]/settings/components/inbox/components'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { isBillingEnabled } from '@/app/workspace/[workspaceId]/settings/navigation'
import { useInboxConfig } from '@/hooks/queries/inbox'
import { useSubscriptionData } from '@/hooks/queries/subscription'
import { useTranslations } from 'next-intl'

export function Inbox() {
  const t = useTranslations('auto')
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string

  const { data: config, isLoading } = useInboxConfig(workspaceId)
  const { data: subscriptionResponse, isLoading: isSubLoading } = useSubscriptionData({
    enabled: isBillingEnabled,
  })
  const subscriptionAccess = getSubscriptionAccessState(subscriptionResponse?.data)

  if (isLoading || (isBillingEnabled && isSubLoading)) {
    return null
  }

  if (isBillingEnabled && !subscriptionAccess.hasUsableMaxAccess) {
    return (
      <div className='flex h-full flex-col bg-[var(--bg)]'>
        <div className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
          <div className='mx-auto flex max-w-[48rem] flex-col gap-4.5 pt-6 pb-6'>
            <div className='flex flex-col items-center justify-center gap-4 py-20'>
              <div className='text-center'>
                <h3 className='font-medium text-[16px] text-[var(--text-primary)]'>
                  {t('sim_mailer_requires_an_active_max')}
                </h3>
                <p className='mt-1.5 text-[14px] text-[var(--text-muted)]'>
                  {t('upgrade_to_max_and_ensure_billing')}
                </p>
              </div>
              <Chip
                variant='primary'
                rightIcon={ArrowRight}
                onClick={() => router.push(`/workspace/${workspaceId}/settings/billing`)}
              >
                {t('upgrade_to_max')}
              </Chip>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <SettingsPanel>
      <InboxEnableToggle />

      {config?.enabled && (
        <>
          <InboxSettingsTab />

          <SettingsSection label={t('inbox')}>
            <p className='mb-3 text-[12px] text-[var(--text-muted)]'>
              {t('email_tasks_received_by_this_workspace')}
            </p>
            <InboxTaskList />
          </SettingsSection>
        </>
      )}
    </SettingsPanel>
  )
}
