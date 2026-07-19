'use client'

import { useMemo, useState } from 'react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Banner,
  ChipConfirmModal,
  ChipInput,
  cn,
  Search,
  Skeleton,
} from '@sim/emcn'
import { useTranslations } from 'next-intl'
import { getBillingPortalLabelKey } from '@/lib/billing/client/provider'
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
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
  const billingPortalLabelKey = getBillingPortalLabelKey()
  const [search, setSearch] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

  const candidates = useMemo(() => {
    const others = members.filter(
      (m) => m.userId !== currentUserId && m.role !== 'owner' && m.role !== 'external'
    )
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

  const hasCandidates = members.some(
    (m) => m.userId !== currentUserId && m.role !== 'owner' && m.role !== 'external'
  )

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
    <ChipConfirmModal
      open={open}
      onOpenChange={handleClose}
      srTitle={tI18n('leave_organization')}
      title={t('leave_organization')}
      confirm={{
        label: 'Transfer & leave',
        onClick: handleConfirm,
        pending: isSubmitting,
        pendingLabel: 'Transferring...',
        disabled: !selectedUserId || !hasCandidates || isLoadingMembers,
      }}
    >
      <div className='flex flex-col gap-4'>
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
          <p className='px-2 text-[var(--text-secondary)] text-sm'>
            {t('you_re_the_only_member_of')}
          </p>
        ) : (
          <div className='space-y-3'>
            <p className='px-2 text-[var(--text-secondary)] text-sm'>
              {t('as_the_owner_you_need_to')}
            </p>

            {hasPaidSubscription && (
              <Banner
                variant='default'
                className='rounded-md px-3 py-2'
                textClassName='text-[var(--text-primary)]'
                actionLabel={
                  isOpeningBillingPortal ? t('opening_billing_portal') : t(billingPortalLabelKey)
                }
                actionDisabled={isOpeningBillingPortal}
                onAction={onOpenBillingPortal}
                text={
                  <>
                    <span className='block font-medium'>
                      {t('your_payment_method_stays_on_this')}
                    </span>
                    <span className='block text-[var(--text-secondary)]'>
                      {t('future_charges_will_keep_hitting_the')}
                    </span>
                  </>
                }
              />
            )}

            {portalError && <p className='px-2 text-[var(--text-error)] text-sm'>{portalError}</p>}

            <ChipInput
              icon={Search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('search_members')}
            />

            <div className='max-h-[280px] overflow-y-auto rounded-md border border-[var(--border-1)]'>
              {candidates.length === 0 ? (
                <div className='px-3 py-4 text-center text-[var(--text-muted)] text-small'>
                  {t('no_members_match')}
                  {search}"
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
                          <Avatar className='size-8 shrink-0'>
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
                                  {t('admin')}
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
          <p className='px-2 text-[var(--text-error)] text-sm'>
            {error instanceof Error && error.message ? error.message : String(error)}
          </p>
        )}
      </div>
    </ChipConfirmModal>
  )
}
