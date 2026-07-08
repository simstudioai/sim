'use client'

import { useCallback, useState } from 'react'
import {
  Badge,
  Chip,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  Tooltip,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { Check, Clipboard, Pencil, Plus, Trash2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import {
  useAddInboxSender,
  useInboxConfig,
  useInboxSenders,
  useRemoveInboxSender,
  useUpdateInboxAddress,
} from '@/hooks/queries/inbox'

export function InboxSettingsTab() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const { data: config } = useInboxConfig(workspaceId)
  const { data: sendersData, isLoading: sendersLoading } = useInboxSenders(workspaceId)
  const updateAddress = useUpdateInboxAddress()
  const addSender = useAddInboxSender()
  const removeSender = useRemoveInboxSender()

  const [isAddSenderOpen, setIsAddSenderOpen] = useState(false)
  const [newSenderEmail, setNewSenderEmail] = useState('')
  const [newSenderLabel, setNewSenderLabel] = useState('')
  const [addSenderError, setAddSenderError] = useState<string | null>(null)

  const [isEditAddressOpen, setIsEditAddressOpen] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [editAddressError, setEditAddressError] = useState<string | null>(null)

  const [removeSenderError, setRemoveSenderError] = useState<string | null>(null)
  const [copiedAddress, setCopiedAddress] = useState(false)

  const handleCopyAddress = useCallback(() => {
    if (config?.address) {
      navigator.clipboard.writeText(config.address)
      setCopiedAddress(true)
      setTimeout(() => setCopiedAddress(false), 2000)
    }
  }, [config?.address])

  const handleEditAddress = useCallback(async () => {
    if (!newUsername.trim()) return
    setEditAddressError(null)
    try {
      await updateAddress.mutateAsync({ workspaceId, username: newUsername.trim() })
      setIsEditAddressOpen(false)
      setNewUsername('')
    } catch (error) {
      setEditAddressError(getErrorMessage(error, 'Failed to update address'))
    }
  }, [workspaceId, newUsername, updateAddress.mutateAsync])

  const handleAddSender = useCallback(async () => {
    if (!newSenderEmail.trim()) return
    setAddSenderError(null)
    try {
      await addSender.mutateAsync({
        workspaceId,
        email: newSenderEmail.trim(),
        label: newSenderLabel.trim() || undefined,
      })
      setIsAddSenderOpen(false)
      setNewSenderEmail('')
      setNewSenderLabel('')
    } catch (error) {
      setAddSenderError(getErrorMessage(error, 'Failed to add sender'))
    }
  }, [workspaceId, newSenderEmail, newSenderLabel, addSender.mutateAsync])

  const handleRemoveSender = useCallback(
    async (senderId: string) => {
      setRemoveSenderError(null)
      try {
        await removeSender.mutateAsync({ workspaceId, senderId })
      } catch (error) {
        setRemoveSenderError(getErrorMessage(error, 'Failed to remove sender'))
      }
    },
    [workspaceId, removeSender.mutateAsync]
  )

  return (
    <>
      <div className='flex flex-col gap-7'>
        {config?.address && (
          <SettingsSection label="Sim's email">
            <div className='flex flex-col gap-1.5'>
              <div className='flex items-center justify-between'>
                <p className='text-[var(--text-muted)] text-caption'>
                  Send emails here to create tasks.
                </p>
                <div className='flex items-center gap-1.5'>
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <button
                        type='button'
                        onClick={handleCopyAddress}
                        className='-my-1 flex size-5 items-center justify-center'
                        aria-label='Copy address'
                      >
                        {copiedAddress ? (
                          <Check className='size-[14px] text-[var(--text-success)]' />
                        ) : (
                          <Clipboard className='size-[14px] text-[var(--text-icon)]' />
                        )}
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Content side='top'>
                      <p>{copiedAddress ? 'Copied!' : 'Copy'}</p>
                    </Tooltip.Content>
                  </Tooltip.Root>
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <button
                        type='button'
                        onClick={() => {
                          setNewUsername('')
                          setEditAddressError(null)
                          setIsEditAddressOpen(true)
                        }}
                        className='-my-1 flex size-5 items-center justify-center'
                        aria-label='Edit address'
                      >
                        <Pencil className='size-[14px] text-[var(--text-icon)]' />
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Content side='top'>
                      <p>Edit</p>
                    </Tooltip.Content>
                  </Tooltip.Root>
                </div>
              </div>
              <ChipInput
                value={config.address}
                readOnly
                inputClassName='cursor-default font-mono text-small'
              />
            </div>
          </SettingsSection>
        )}

        <SettingsSection label='Allowed senders'>
          <div className='flex flex-col gap-1.5'>
            <p className='text-[var(--text-muted)] text-caption'>
              Only emails from these addresses can create tasks.
            </p>

            <div className='mt-1 flex flex-col gap-[1px] overflow-hidden rounded-lg border border-[var(--border)]'>
              {sendersLoading ? null : (
                <>
                  {sendersData?.workspaceMembers.map((member) => (
                    <div
                      key={member.email}
                      className='flex items-center justify-between border-[var(--border)] border-b px-3 py-2.5 last:border-b-0'
                    >
                      <div className='flex items-center gap-2'>
                        <span className='text-[var(--text-body)] text-sm'>{member.email}</span>
                        <Badge variant='gray' className='text-xs'>
                          member
                        </Badge>
                      </div>
                    </div>
                  ))}

                  {sendersData?.senders.map((sender) => (
                    <div
                      key={sender.id}
                      className='flex items-center justify-between border-[var(--border)] border-b px-3 py-2.5 last:border-b-0'
                    >
                      <div className='flex items-center gap-2'>
                        <span className='text-[var(--text-body)] text-sm'>{sender.email}</span>
                        {sender.label && (
                          <span className='text-[var(--text-muted)] text-caption'>
                            ({sender.label})
                          </span>
                        )}
                      </div>
                      <Chip
                        flush
                        leftIcon={Trash2}
                        aria-label='Remove sender'
                        onClick={() => handleRemoveSender(sender.id)}
                      />
                    </div>
                  ))}

                  {sendersData?.workspaceMembers.length === 0 &&
                    sendersData?.senders.length === 0 && (
                      <div className='px-3 py-2.5 text-[var(--text-muted)] text-caption'>
                        No allowed senders configured.
                      </div>
                    )}
                </>
              )}
            </div>

            {removeSenderError && (
              <p className='px-3 text-[var(--text-error)] text-caption leading-tight'>
                {removeSenderError}
              </p>
            )}

            <Chip
              className='mt-1 w-fit'
              leftIcon={Plus}
              onClick={() => {
                setNewSenderEmail('')
                setNewSenderLabel('')
                setAddSenderError(null)
                setIsAddSenderOpen(true)
              }}
            >
              Add sender
            </Chip>
          </div>
        </SettingsSection>
      </div>

      <ChipModal
        open={isAddSenderOpen}
        onOpenChange={setIsAddSenderOpen}
        srTitle='Add allowed sender'
      >
        <ChipModalHeader onClose={() => setIsAddSenderOpen(false)}>
          Add allowed sender
        </ChipModalHeader>
        <ChipModalBody>
          <ChipModalField
            type='email'
            title='Email address'
            value={newSenderEmail}
            onChange={(v) => {
              setNewSenderEmail(v)
              if (addSenderError) setAddSenderError(null)
            }}
            required
            placeholder='user@example.com'
          />
          <ChipModalField
            type='input'
            title='Label'
            value={newSenderLabel}
            onChange={setNewSenderLabel}
            placeholder='e.g., John from Marketing'
          />
          <ChipModalError>{addSenderError}</ChipModalError>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => setIsAddSenderOpen(false)}
          primaryAction={{
            label: 'Add',
            onClick: handleAddSender,
            disabled: !newSenderEmail.trim() || addSender.isPending,
          }}
        />
      </ChipModal>

      <ChipModal
        open={isEditAddressOpen}
        onOpenChange={setIsEditAddressOpen}
        srTitle='Change email address'
      >
        <ChipModalHeader onClose={() => setIsEditAddressOpen(false)}>
          Change email address
        </ChipModalHeader>
        <ChipModalBody>
          <p className='px-2 text-[var(--text-secondary)] text-sm'>
            Changing your email address will create a new inbox.{' '}
            <span className='font-medium text-[var(--text-primary)]'>
              The old address will stop receiving emails immediately.
            </span>
          </p>
          <ChipModalField
            type='input'
            title='New email prefix'
            value={newUsername}
            onChange={(value) => {
              setNewUsername(value)
              if (editAddressError) setEditAddressError(null)
            }}
            onSubmit={handleEditAddress}
            placeholder='e.g., new-acme'
            error={editAddressError}
          />
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => setIsEditAddressOpen(false)}
          cancelDisabled={updateAddress.isPending}
          primaryAction={{
            label: updateAddress.isPending ? 'Updating...' : 'Change address',
            onClick: handleEditAddress,
            disabled: !newUsername.trim() || updateAddress.isPending,
            variant: 'destructive',
          }}
        />
      </ChipModal>
    </>
  )
}
