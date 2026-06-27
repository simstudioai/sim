'use client'

import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  Switch,
} from '@/components/emcn'
import { useInboxConfig, useToggleInbox } from '@/hooks/queries/inbox'

const logger = createLogger('InboxEnableToggle')

export function InboxEnableToggle() {
  const t = useTranslations('auto')
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const { data: config } = useInboxConfig(workspaceId)
  const toggleInbox = useToggleInbox()

  const [isEnableOpen, setIsEnableOpen] = useState(false)
  const [isDisableOpen, setIsDisableOpen] = useState(false)
  const [enableUsername, setEnableUsername] = useState('')

  const handleToggle = useCallback(
    async (checked: boolean) => {
      if (checked) {
        setIsEnableOpen(true)
        return
      }
      setIsDisableOpen(true)
    },
    [workspaceId]
  )

  const handleDisable = useCallback(async () => {
    try {
      await toggleInbox.mutateAsync({ workspaceId, enabled: false })
      setIsDisableOpen(false)
    } catch (error) {
      logger.error('Failed to disable inbox', { error })
    }
  }, [workspaceId])

  const handleEnable = useCallback(async () => {
    try {
      await toggleInbox.mutateAsync({
        workspaceId,
        enabled: true,
        username: enableUsername.trim() || undefined,
      })
      setIsEnableOpen(false)
      setEnableUsername('')
    } catch (error) {
      logger.error('Failed to enable inbox', { error })
    }
  }, [workspaceId, enableUsername])

  return (
    <>
      <div className='flex items-center justify-between'>
        <div className='flex flex-col gap-1'>
          <span className='text-[13px] text-[var(--text-primary)]'>{t('enable_email_inbox')}</span>
          <span className='text-[12px] text-[var(--text-muted)]'>
            {t('allow_this_workspace_to_receive_tasks')}
          </span>
        </div>
        <Switch
          checked={config?.enabled ?? false}
          onCheckedChange={handleToggle}
          disabled={toggleInbox.isPending}
        />
      </div>

      <ChipModal open={isEnableOpen} onOpenChange={setIsEnableOpen} srTitle='Enable email inbox'>
        <ChipModalHeader onClose={() => setIsEnableOpen(false)}>
          {t('enable_email_inbox')}
        </ChipModalHeader>
        <ChipModalBody>
          <p className='px-2 text-[var(--text-secondary)] text-sm'>
            {t('an_email_address_will_be_created')}
          </p>
          <ChipModalField
            type='input'
            title={t('email_prefix')}
            value={enableUsername}
            onChange={setEnableUsername}
            placeholder={t('optional_leave_blank_to_auto_generate')}
          />
          <p className='px-2 text-[var(--text-muted)] text-sm'>
            {t('leave_blank_for_an_auto_generated')}
          </p>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => setIsEnableOpen(false)}
          primaryAction={{
            label: 'Enable',
            onClick: handleEnable,
            disabled: toggleInbox.isPending,
          }}
        />
      </ChipModal>

      <ChipConfirmModal
        open={isDisableOpen}
        onOpenChange={setIsDisableOpen}
        srTitle='Disable email inbox'
        title={t('disable_email_inbox')}
        text={[
          'Are you sure you want to disable the inbox',
          config?.address && ' ',
          config?.address && { text: config.address, bold: true },
          '? Any emails sent to this address after disabling will not be delivered. This action cannot be undone.',
        ]}
        confirm={{
          label: 'Disable inbox',
          onClick: handleDisable,
          pending: toggleInbox.isPending,
          pendingLabel: 'Disabling...',
        }}
      >
        <p className='px-2 text-[var(--text-secondary)] text-sm'>
          {t('your_existing_conversations_and_task_history')}
        </p>
      </ChipConfirmModal>
    </>
  )
}
