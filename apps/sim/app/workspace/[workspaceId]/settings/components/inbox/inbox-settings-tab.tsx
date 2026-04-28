'use client'

import { useCallback, useState } from 'react'
import { Check, Clipboard, Pencil, Plus, Trash2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Badge,
  Button,
  Input as EmcnInput,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Skeleton,
  Tooltip,
} from '@/components/emcn'
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
      setEditAddressError(error instanceof Error ? error.message : 'Failed to update address')
    }
  }, [workspaceId, newUsername])

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
      setAddSenderError(error instanceof Error ? error.message : 'Failed to add sender')
    }
  }, [workspaceId, newSenderEmail, newSenderLabel])

  const handleRemoveSender = useCallback(
    async (senderId: string) => {
      setRemoveSenderError(null)
      try {
        await removeSender.mutateAsync({ workspaceId, senderId })
      } catch (error) {
        setRemoveSenderError(error instanceof Error ? error.message : 'Failed to remove sender')
      }
    },
    [workspaceId]
  )

  return (
    <>
      <div className='flex flex-col gap-6'>
        {config?.address && (
          <div className='flex flex-col gap-1.5'>
            <div className='font-medium text-[var(--text-secondary)] text-sm'>Sim&apos;s email</div>
            <div className='flex items-center justify-between'>
              <p className='text-[var(--text-muted)] text-small'>
                Send emails here to create tasks.
              </p>
              <div className='flex items-center gap-1.5'>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      type='button'
                      onClick={handleCopyAddress}
                      className='-my-1 flex h-5 w-5 items-center justify-center'
                      aria-label='Copy address'
                    >
                      {copiedAddress ? (
                        <Check className='h-3 w-3 text-green-500' />
                      ) : (
                        <Clipboard className='h-3 w-3 text-muted-foreground' />
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
                      className='-my-1 flex h-5 w-5 items-center justify-center'
                      aria-label='Edit address'
                    >
                      <Pencil className='h-3 w-3 text-muted-foreground' />
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top'>
                    <p>Edit</p>
                  </Tooltip.Content>
                </Tooltip.Root>
              </div>
            </div>
            <EmcnInput
              value={config.address}
              readOnly
              className='h-9 cursor-default font-mono text-small'
            />
          </div>
        )}

        <div className='flex flex-col gap-1.5'>
          <div className='font-medium text-[var(--text-secondary)] text-sm'>Allowed senders</div>
          <p className='text-[var(--text-muted)] text-small'>
            Only emails from these addresses can create tasks.
          </p>

          <div className='mt-1 flex flex-col gap-[1px] overflow-hidden rounded-lg border border-[var(--border)]'>
            {sendersLoading ? (
              <div className='px-3 py-2.5'>
                <Skeleton className='h-[16px] w-[200px]' />
              </div>
            ) : (
              <>
                {sendersData?.workspaceMembers.map((member) => (
                  <div
                    key={member.email}
                    className='flex items-center justify-between border-[var(--border)] border-b px-3 py-2.5 last:border-b-0'
                  >
                    <div className='flex items-center gap-2'>
                      <span className='text-[var(--text-primary)] text-small'>{member.email}</span>
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
                      <span className='text-[var(--text-primary)] text-small'>{sender.email}</span>
                      {sender.label && (
                        <span className='text-[var(--text-muted)] text-caption'>
                          ({sender.label})
                        </span>
                      )}
                    </div>
                    <Button
                      variant='ghost'
                      className='h-[28px] w-[28px] p-0 text-[var(--text-muted)] hover-hover:text-[var(--text-error)]'
                      onClick={() => handleRemoveSender(sender.id)}
                    >
                      <Trash2 className='h-[14px] w-[14px]' />
                    </Button>
                  </div>
                ))}

                {sendersData?.workspaceMembers.length === 0 &&
                  sendersData?.senders.length === 0 && (
                    <div className='px-3 py-2.5 text-[var(--text-muted)] text-small'>
                      No allowed senders configured.
                    </div>
                  )}
              </>
            )}
          </div>

          {removeSenderError && (
            <p className='px-3 text-[var(--text-error)] text-small leading-tight'>
              {removeSenderError}
            </p>
          )}

          <Button
            variant='ghost'
            className='mt-1 w-fit'
            onClick={() => {
              setNewSenderEmail('')
              setNewSenderLabel('')
              setAddSenderError(null)
              setIsAddSenderOpen(true)
            }}
          >
            <Plus className='mr-1.5 h-[13px] w-[13px]' />
            Add sender
          </Button>
        </div>
      </div>

      <Modal open={isAddSenderOpen} onOpenChange={setIsAddSenderOpen}>
        <ModalContent size='sm'>
          <ModalHeader>Add allowed sender</ModalHeader>
          <ModalBody>
            <div className='flex flex-col gap-3'>
              <div className='flex flex-col gap-1'>
                <p className='font-medium text-[var(--text-secondary)] text-sm'>Email address</p>
                <EmcnInput
                  value={newSenderEmail}
                  onChange={(e) => {
                    setNewSenderEmail(e.target.value)
                    if (addSenderError) setAddSenderError(null)
                  }}
                  placeholder='user@example.com'
                  className='h-9'
                />
              </div>
              <div className='flex flex-col gap-1'>
                <p className='font-medium text-[var(--text-secondary)] text-sm'>Label (optional)</p>
                <EmcnInput
                  value={newSenderLabel}
                  onChange={(e) => setNewSenderLabel(e.target.value)}
                  placeholder='e.g., John from Marketing'
                  className='h-9'
                />
              </div>
              {addSenderError && (
                <p className='text-[var(--text-error)] text-small leading-tight'>
                  {addSenderError}
                </p>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setIsAddSenderOpen(false)}>
              Cancel
            </Button>
            <Button
              variant='primary'
              onClick={handleAddSender}
              disabled={!newSenderEmail.trim() || addSender.isPending}
            >
              {addSender.isPending ? 'Adding...' : 'Add'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal open={isEditAddressOpen} onOpenChange={setIsEditAddressOpen}>
        <ModalContent size='sm'>
          <ModalHeader>Change email address</ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)]'>
              Changing your email address will create a new inbox.{' '}
              <span className='font-medium text-[var(--text-primary)]'>
                The old address will stop receiving emails immediately.
              </span>
            </p>
            <div className='mt-4 flex flex-col gap-1'>
              <p className='font-medium text-[var(--text-secondary)] text-sm'>New email prefix</p>
              <EmcnInput
                value={newUsername}
                onChange={(e) => {
                  setNewUsername(e.target.value)
                  if (editAddressError) setEditAddressError(null)
                }}
                placeholder='e.g., new-acme'
                className='h-9'
              />
              {editAddressError && (
                <p className='text-[var(--text-error)] text-small leading-tight'>
                  {editAddressError}
                </p>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setIsEditAddressOpen(false)}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleEditAddress}
              disabled={!newUsername.trim() || updateAddress.isPending}
            >
              {updateAddress.isPending ? 'Updating...' : 'Change address'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
