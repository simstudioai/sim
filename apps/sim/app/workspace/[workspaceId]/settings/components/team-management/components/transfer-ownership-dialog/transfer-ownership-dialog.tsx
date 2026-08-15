'use client'

import { useMemo, useState } from 'react'
import {
  Banner,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  Skeleton,
  Table,
  type TableColumn,
  TableIdentityCell,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { ORGANIZATION_ROLE_LABELS } from '@/app/workspace/[workspaceId]/settings/components/team-management/member-rows'
import type { RosterMember } from '@/hooks/queries/organization'

/**
 * Candidates are ranked admins-first because an admin already holds most of what
 * ownership adds, then alphabetically so the list is stable between opens.
 */
function byOwnershipReadiness(a: RosterMember, b: RosterMember) {
  if (a.role === 'admin' && b.role !== 'admin') return -1
  if (a.role !== 'admin' && b.role === 'admin') return 1
  return a.name.localeCompare(b.name)
}

const CANDIDATE_COLUMNS: TableColumn<RosterMember>[] = [
  {
    key: 'identity',
    cell: (member) => (
      <TableIdentityCell
        primary={member.name}
        secondary={member.name === member.email ? undefined : member.email}
        imageSrc={member.image ?? undefined}
      />
    ),
  },
  {
    key: 'role',
    align: 'right',
    width: 96,
    cell: (member) => ORGANIZATION_ROLE_LABELS[member.role],
  },
]

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

/**
 * Hands the organization to another member and leaves. Structured as an ordinary
 * chip modal — header, one labelled field, footer — rather than a confirm modal,
 * because the decision the user makes here is a *choice from a list*, not a
 * yes/no. The list is the shared `Table` in single-select mode, so a candidate
 * row reads exactly like a member row on the Members page.
 */
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

  /** Ownership can only pass to an internal member who is not already the owner. */
  const eligible = useMemo(
    () =>
      members.filter(
        (member) =>
          member.userId !== currentUserId && member.role !== 'owner' && member.role !== 'external'
      ),
    [members, currentUserId]
  )

  const candidates = useMemo(() => {
    const ranked = [...eligible].sort(byOwnershipReadiness)
    const query = search.trim().toLowerCase()
    if (!query) return ranked
    return ranked.filter(
      (member) =>
        member.name.toLowerCase().includes(query) || member.email.toLowerCase().includes(query)
    )
  }, [eligible, search])

  const handleClose = (next: boolean) => {
    if (!next) {
      setSearch('')
      setSelectedUserId(null)
    }
    onOpenChange(next)
  }

  const handleConfirm = () => {
    if (!selectedUserId) return
    void onConfirm(selectedUserId)
  }

  return (
    <ChipModal open={open} onOpenChange={handleClose} srTitle='Leave organization'>
      <ChipModalHeader onClose={() => handleClose(false)}>Leave organization</ChipModalHeader>
      <ChipModalBody>
        {hasPaidSubscription && (
          /**
           * Wrapped to the field gutter: `ChipModalBody` pads `px-2` and every
           * `ChipModalField` adds another `px-2`, so a bare notice would sit 8px
           * proud of the field beneath it.
           */
          <div className='px-2'>
            <Banner
              variant='default'
              actionLabel={isOpeningBillingPortal ? 'Opening...' : 'Open billing portal'}
              actionDisabled={isOpeningBillingPortal}
              onAction={onOpenBillingPortal}
              text='Your payment method stays on this organization. Remove it in Stripe before you leave.'
            />
          </div>
        )}

        {isLoadingMembers ? (
          <ChipModalField type='custom' title='New owner'>
            <div className='flex flex-col gap-2'>
              <Skeleton className='h-[30px] w-full rounded-lg' />
              <Skeleton className='h-[120px] w-full rounded-lg' />
            </div>
          </ChipModalField>
        ) : eligible.length === 0 ? (
          <ChipModalField
            type='custom'
            title='New owner'
            hint='Invite another member before you can leave.'
          >
            <p className='text-[var(--text-muted)] text-small'>
              You're the only member of this organization.
            </p>
          </ChipModalField>
        ) : (
          <ChipModalField
            type='custom'
            title='New owner'
            hint='They inherit billing, seats, and every owner-only permission. You lose access to this organization and its workspaces.'
          >
            <Table
              aria-label='Ownership candidates'
              /** The search row plus roughly four candidates; the rest scroll. */
              className='max-h-[260px]'
              rows={candidates}
              getRowId={(member) => member.userId}
              columns={CANDIDATE_COLUMNS}
              toolbar={{
                search: {
                  value: search,
                  onChange: setSearch,
                  placeholder: 'Search members...',
                },
              }}
              selection={{
                mode: 'single',
                selectedId: selectedUserId,
                onSelect: setSelectedUserId,
              }}
              empty={`No members match "${search.trim()}"`}
            />
          </ChipModalField>
        )}

        <ChipModalError>
          {portalError ?? (error ? getErrorMessage(error, 'Failed to transfer ownership') : null)}
        </ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => handleClose(false)}
        cancelDisabled={isSubmitting}
        primaryAction={{
          label: isSubmitting ? 'Transferring...' : 'Transfer & leave',
          onClick: handleConfirm,
          disabled: !selectedUserId || isSubmitting || isLoadingMembers,
        }}
      />
    </ChipModal>
  )
}
