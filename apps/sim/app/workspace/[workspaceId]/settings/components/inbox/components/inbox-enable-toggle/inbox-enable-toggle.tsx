'use client'

import { useCallback, useState } from 'react'
import {
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  Label,
  Switch,
} from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import { useInboxConfig, useToggleInbox } from '@/hooks/queries/inbox'

const logger = createLogger('InboxEnableToggle')

export function InboxEnableToggle() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const { data: config } = useInboxConfig(workspaceId)
  const toggleInbox = useToggleInbox()

  const [isEnableOpen, setIsEnableOpen] = useState(false)
  const [isDisableOpen, setIsDisableOpen] = useState(false)
  const [enableUsername, setEnableUsername] = useState('')

  const handleToggle = useCallback(async (checked: boolean) => {
    if (checked) {
      setIsEnableOpen(true)
      return
    }
    setIsDisableOpen(true)
  }, [])

  const handleDisable = useCallback(async () => {
    try {
      await toggleInbox.mutateAsync({ workspaceId, enabled: false })
      setIsDisableOpen(false)
    } catch (error) {
      logger.error('Failed to disable inbox', { error })
    }
  }, [workspaceId, toggleInbox.mutateAsync])

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
  }, [workspaceId, enableUsername, toggleInbox.mutateAsync])

  return (
    <>
      <div className='flex items-center justify-between'>
        <div className='flex flex-col gap-1'>
          <Label htmlFor='inbox-enabled'>Enable email inbox</Label>
          <p className='text-[var(--text-muted)] text-caption'>
            Allow this workspace to receive tasks via email
          </p>
        </div>
        <Switch
          id='inbox-enabled'
          checked={config?.enabled ?? false}
          onCheckedChange={handleToggle}
          disabled={toggleInbox.isPending}
        />
      </div>

      <ChipModal open={isEnableOpen} onOpenChange={setIsEnableOpen} srTitle='Enable email inbox'>
        <ChipModalHeader onClose={() => setIsEnableOpen(false)}>Enable email inbox</ChipModalHeader>
        <ChipModalBody>
          <p className='px-2 text-[var(--text-secondary)] text-sm'>
            An email address will be created for this workspace. Anyone in the allowed senders list
            can email it to create tasks.
          </p>
          <ChipModalField
            type='input'
            title='Email prefix'
            value={enableUsername}
            onChange={setEnableUsername}
            placeholder='Optional — leave blank to auto-generate'
          />
          <p className='px-2 text-[var(--text-muted)] text-sm'>
            Leave blank for an auto-generated address.
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
        title='Disable email inbox'
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
          Your existing conversations and task history will be preserved.
        </p>
      </ChipConfirmModal>
    </>
  )
}
