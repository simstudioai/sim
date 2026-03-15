'use client'

import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import {
  Button,
  Input as EmcnInput,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Switch,
} from '@/components/emcn'
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
        <div className='flex flex-col gap-[2px]'>
          <span className='font-medium text-[14px] text-[var(--text-primary)]'>
            Enable email inbox
          </span>
          <span className='text-[13px] text-[var(--text-muted)]'>
            Allow this workspace to receive tasks via email
          </span>
        </div>
        <Switch
          checked={config?.enabled ?? false}
          onCheckedChange={handleToggle}
          disabled={toggleInbox.isPending}
        />
      </div>

      <Modal open={isEnableOpen} onOpenChange={setIsEnableOpen}>
        <ModalContent size='sm'>
          <ModalHeader>Enable email inbox</ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)]'>
              An email address will be created for this workspace. Anyone in the allowed senders
              list can email it to create tasks.
            </p>
            <div className='mt-[16px] flex flex-col gap-[8px]'>
              <p className='font-medium text-[14px] text-[var(--text-secondary)]'>
                Custom email prefix (optional)
              </p>
              <EmcnInput
                value={enableUsername}
                onChange={(e) => setEnableUsername(e.target.value)}
                placeholder='e.g., acme'
                className='h-9'
                autoFocus
              />
              <p className='text-[12px] text-[var(--text-muted)]'>
                Leave blank for an auto-generated address.
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setIsEnableOpen(false)}>
              Cancel
            </Button>
            <Button variant='primary' onClick={handleEnable} disabled={toggleInbox.isPending}>
              {toggleInbox.isPending ? 'Enabling...' : 'Enable'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal open={isDisableOpen} onOpenChange={setIsDisableOpen}>
        <ModalContent size='sm'>
          <ModalHeader>Disable email inbox</ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)]'>
              Are you sure you want to disable the inbox
              {config?.address && (
                <>
                  {' '}
                  <span className='font-medium text-[var(--text-primary)]'>{config.address}</span>
                </>
              )}
              ? Any emails sent to this address after disabling will not be delivered.{' '}
              <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
            <p className='mt-[8px] text-[var(--text-secondary)]'>
              Your existing conversations and task history will be preserved.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setIsDisableOpen(false)}>
              Cancel
            </Button>
            <Button variant='destructive' onClick={handleDisable} disabled={toggleInbox.isPending}>
              {toggleInbox.isPending ? 'Disabling...' : 'Disable inbox'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
