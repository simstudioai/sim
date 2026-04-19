'use client'

import { useMemo, useState } from 'react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Banner,
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Skeleton,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { getUserColor } from '@/lib/workspaces/colors'
import type { RosterMember } from '@/hooks/queries/organization'

interface TransferOwnershipDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  members: RosterMember[]
  isLoadingMembers: boolean
  currentUserId: string
  isSubmitting: boolean
  error?: Error | null
  portalError?: string | null
  hasPaidSubscription: boolean
  isOpeningBillingPortal: boolean
  onConfirm: (newOwnerUserId: string) => Promise<void>
  onOpenBillingPortal: () => void
}

export function TransferOwnershipDialog({
  open,
  onOpenChange,
  members,
  isLoadingMembers,
  currentUserId,
  isSubmitting,
  error,
  portalError,
  hasPaidSubscription,
  isOpeningBillingPortal,
  onConfirm,
  onOpenBillingPortal,
}: TransferOwnershipDialogProps) {
  const [search, setSearch] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

  const candidates = useMemo(() => {
    const others = members.filter((m) => m.userId !== currentUserId && m.role !== 'owner')
    others.sort((a, b) => {
      if (a.role === 'admin' && b.role !== 'admin') return -1
      if (a.role !== 'admin' && b.role === 'admin') return 1
      return a.name.localeCompare(b.name)
    })
    if (!search.trim()) return others
    const q = search.trim().toLowerCase()
    return others.filter(
      (m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
    )
  }, [members, currentUserId, search])

  const hasCandidates = members.some((m) => m.userId !== currentUserId && m.role !== 'owner')

  const handleClose = (next: boolean) => {
    if (!next) {
      setSearch('')
      setSelectedUserId(null)
    }
    onOpenChange(next)
  }

  const handleConfirm = async () => {
    if (!selectedUserId) return
    await onConfirm(selectedUserId)
  }

  return (
    <Modal open={open} onOpenChange={handleClose}>
      <ModalContent size='md'>
        <ModalHeader>Leave organization</ModalHeader>
        <ModalBody>
          {isLoadingMembers ? (
            <div className='space-y-3'>
              <Skeleton className='h-4 w-3/4' />
              <Skeleton className='h-4 w-1/2' />
              <div className='space-y-2 pt-2'>
                <Skeleton className='h-10 w-full' />
                <Skeleton className='h-10 w-full' />
                <Skeleton className='h-10 w-full' />
              </div>
            </div>
          ) : !hasCandidates ? (
            <p className='text-[var(--text-secondary)]'>
              You're the only member of this organization. Invite another admin before leaving.
            </p>
          ) : (
            <div className='space-y-3'>
              <p className='text-[var(--text-secondary)]'>
                As the owner, you need to hand off the organization before you can leave. Pick a
                member to become the new owner. They'll inherit billing access, seat management, and
                all owner-only permissions. You'll lose access to every shared workspace in this
                organization.
              </p>

              {hasPaidSubscription && (
                <Banner
                  variant='default'
                  className='rounded-md px-3 py-2'
                  textClassName='text-[var(--text-primary)]'
                  actionLabel={isOpeningBillingPortal ? 'Opening...' : 'Open Stripe billing portal'}
                  actionDisabled={isOpeningBillingPortal}
                  onAction={onOpenBillingPortal}
                  text={
                    <>
                      <span className='block font-medium'>
                        Your payment method stays on this organization
                      </span>
                      <span className='block text-[var(--text-secondary)]'>
                        Future charges will keep hitting the card you added. Open the Stripe billing
                        portal to remove it before you leave.
                      </span>
                    </>
                  }
                />
              )}

              {portalError && (
                <p className='text-[var(--text-error)] text-small leading-tight'>{portalError}</p>
              )}

              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder='Search members...'
              />

              <div className='max-h-[280px] overflow-y-auto rounded-md border border-[var(--border-1)]'>
                {candidates.length === 0 ? (
                  <div className='px-3 py-4 text-center text-[var(--text-muted)] text-small'>
                    No members match "{search}"
                  </div>
                ) : (
                  <ul className='divide-y divide-[var(--border-1)]'>
                    {candidates.map((m) => {
                      const isSelected = selectedUserId === m.userId
                      return (
                        <li key={m.userId}>
                          <button
                            type='button'
                            onClick={() => setSelectedUserId(m.userId)}
                            className={cn(
                              'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                              isSelected
                                ? 'bg-[var(--surface-active)]'
                                : 'hover-hover:bg-[var(--surface-hover)]'
                            )}
                          >
                            <Avatar className='h-8 w-8 shrink-0'>
                              {m.image && <AvatarImage src={m.image} alt={m.name} />}
                              <AvatarFallback
                                style={{ background: getUserColor(m.userId || m.email) }}
                                className='border-0 text-white'
                              >
                                {m.name.charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className='min-w-0 flex-1'>
                              <div className='flex items-center gap-2'>
                                <span className='truncate font-medium text-[var(--text-primary)] text-small'>
                                  {m.name}
                                </span>
                                {m.role === 'admin' && (
                                  <Badge variant='gray-secondary' size='sm'>
                                    Admin
                                  </Badge>
                                )}
                              </div>
                              <div className='truncate text-[var(--text-muted)] text-caption'>
                                {m.email}
                              </div>
                            </div>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}

          {error && (
            <p className='mt-3 text-[var(--text-error)] text-small leading-tight'>
              {error instanceof Error && error.message ? error.message : String(error)}
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant='default' onClick={() => handleClose(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant='destructive'
            onClick={handleConfirm}
            disabled={!selectedUserId || isSubmitting || !hasCandidates || isLoadingMembers}
          >
            {isSubmitting ? 'Transferring...' : 'Transfer & leave'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
