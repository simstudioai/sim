'use client'

import { useMemo, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Modal } from '@sim/emcn/modal'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { InlineNotice } from '@sim/emcn/status'
import { useOwnershipTransfer } from '@/platform/lib/data/members'
import type { RosterModel } from '@/platform/shared/members'

interface TransferOwnershipModalProps {
  open: boolean
  onClose: () => void
  roster: RosterModel | undefined
  hasPaidSubscription: boolean
}

/** Hands the organization to another member and leaves it, the only transfer this surface offers. */
export function TransferOwnershipModal({
  open,
  onClose,
  roster,
  hasPaidSubscription,
}: TransferOwnershipModalProps) {
  const transfer = useOwnershipTransfer()
  const [selected, setSelected] = useState<string | null>(null)
  const candidates = useMemo(
    () =>
      (roster?.members ?? [])
        .filter((row) => !row.isSelf && row.role !== 'owner' && row.role !== 'external')
        .sort((a, b) => {
          if (a.role === 'admin' && b.role !== 'admin') return -1
          if (a.role !== 'admin' && b.role === 'admin') return 1
          return a.name.localeCompare(b.name)
        })
        .map((row) => ({
          value: row.userId,
          label: `${row.name} · ${row.email}${row.role === 'admin' ? ' · Admin' : ''}`,
        })),
    [roster]
  )
  const hasCandidates = candidates.length > 0
  return (
    <Modal
      title='Leave organization'
      open={open}
      onOpenChange={(next) => {
        if (next) return
        setSelected(null)
        onClose()
      }}
      confirmLabel='Transfer and leave'
      confirmDisabled={!selected}
      onConfirm={async () => {
        if (selected) await transfer.confirm(selected)
      }}
    >
      {!roster ? null : !hasCandidates ? (
        <p data-type='T060'>
          You're the only member of this organization. Invite another admin before leaving.
        </p>
      ) : (
        <>
          <p data-type='T060'>
            As the owner, you need to hand off the organization before you can leave. Pick a member
            to become the new owner. They'll inherit billing access, seat management, and all
            owner-only permissions. You'll lose access to every shared workspace in this
            organization.
          </p>
          {hasPaidSubscription && (
            <InlineNotice
              title='Your payment method stays on this organization'
              message='Future charges will keep hitting the card you added. Open the Stripe billing portal to remove it before you leave.'
              action={
                <Button
                  size='compact'
                  disabled={transfer.portalDisabled}
                  onClick={transfer.openBillingPortal}
                >
                  {transfer.portalPending ? 'Opening…' : 'Open billing portal'}
                </Button>
              }
            />
          )}
          {transfer.portalError && <InlineNotice intent='danger' message={transfer.portalError} />}
          <SearchableSelect
            label='New owner'
            searchLabel='Search members'
            placeholder='Select a member'
            options={candidates}
            value={selected}
            onValueChange={setSelected}
          />
        </>
      )}
    </Modal>
  )
}
