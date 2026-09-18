'use client'

import { useState } from 'react'
import {
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipSwitch,
  Label,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useParams } from 'next/navigation'
import { useInboxConfig, useToggleInbox } from '@/hooks/queries/inbox'

const INBOX_OPTIONS = [
  { value: 'enabled', label: 'On' },
  { value: 'disabled', label: 'Off' },
] as const

export function InboxEnableToggle() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const { data: config } = useInboxConfig(workspaceId)
  const toggleInbox = useToggleInbox()

  const [isEnableOpen, setIsEnableOpen] = useState(false)
  const [isDisableOpen, setIsDisableOpen] = useState(false)
  const [enableUsername, setEnableUsername] = useState('')

  function handleToggle(checked: boolean) {
    toggleInbox.reset()
    if (checked) {
      setIsEnableOpen(true)
    } else {
      setIsDisableOpen(true)
    }
  }

  function handleEnableOpenChange(open: boolean) {
    if (!toggleInbox.isPending) setIsEnableOpen(open)
  }

  function handleDisable() {
    toggleInbox.mutate(
      { workspaceId, enabled: false },
      { onSuccess: () => setIsDisableOpen(false) }
    )
  }

  function handleEnable() {
    toggleInbox.mutate(
      { workspaceId, enabled: true, username: enableUsername.trim() || undefined },
      {
        onSuccess: () => {
          setIsEnableOpen(false)
          setEnableUsername('')
        },
      }
    )
  }

  const error = toggleInbox.error
    ? getErrorMessage(toggleInbox.error, 'Failed to update inbox')
    : null

  return (
    <>
      <div className='flex items-center justify-between'>
        <div className='flex flex-col gap-1'>
          <Label>Enable email inbox</Label>
          <p className='text-[var(--text-muted)] text-caption'>
            Allow this workspace to receive tasks via email
          </p>
        </div>
        <ChipSwitch
          aria-label='Enable email inbox'
          options={INBOX_OPTIONS}
          value={config?.enabled ? 'enabled' : 'disabled'}
          onChange={(value) => handleToggle(value === 'enabled')}
          disabled={toggleInbox.isPending}
        />
      </div>

      <ChipModal
        open={isEnableOpen}
        onOpenChange={handleEnableOpenChange}
        srTitle='Enable email inbox'
      >
        <ChipModalHeader onClose={() => handleEnableOpenChange(false)}>
          Enable email inbox
        </ChipModalHeader>
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
          <ChipModalError>{error}</ChipModalError>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => handleEnableOpenChange(false)}
          cancelDisabled={toggleInbox.isPending}
          primaryAction={{
            label: toggleInbox.isPending ? 'Enabling...' : 'Enable',
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
        <ChipModalError>{error}</ChipModalError>
      </ChipConfirmModal>
    </>
  )
}
