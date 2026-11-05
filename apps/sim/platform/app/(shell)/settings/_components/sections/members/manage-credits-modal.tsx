'use client'

import { useState } from 'react'
import { Button, InlineNotice, Modal, TextField } from '@/platform/design-system/components'
import { type MemberRowModel, useMemberCredits } from '@/platform/lib/data/members'

interface ManageCreditsModalProps {
  member: MemberRowModel | null
  onClose: () => void
}

/** The draft seeds from the loaded limit until the admin types, so a refetch can't clobber an edit. */
export function ManageCreditsModal({ member, onClose }: ManageCreditsModalProps) {
  const credits = useMemberCredits(member?.userId)
  const [edit, setEdit] = useState<string | null>(null)
  const seeded = credits.usage?.creditLimit
  const draft = edit ?? (seeded === undefined || seeded === null ? '' : String(seeded))
  const trimmed = draft.trim()
  const limit = trimmed === '' ? null : Number(trimmed)
  const valid = limit === null || (Number.isInteger(limit) && limit >= 0)
  const usage = credits.usage
  const usedTitle = usage
    ? `Credits used this ${usage.billingInterval === 'year' ? 'year' : 'month'}`
    : 'Credits used'
  return (
    <Modal
      title={member ? `Manage credits — ${member.name || member.email}` : 'Manage credits'}
      open={member !== null}
      onOpenChange={(open) => !open && onClose()}
      confirmLabel='Save'
      confirmDisabled={credits.loading || !usage || !valid || limit === (seeded ?? null)}
      onConfirm={() => credits.save(limit)}
    >
      {credits.error ? (
        <InlineNotice
          intent='danger'
          title='Could not load credit usage'
          message={credits.error.message}
          action={
            <Button size='compact' onClick={credits.retry}>
              Retry
            </Button>
          }
        />
      ) : (
        <>
          <TextField
            label={usedTitle}
            value={credits.loading ? 'Loading…' : (usage?.creditsUsed.toLocaleString() ?? '—')}
            readOnly
          />
          <TextField
            label='Credit limit'
            inputMode='numeric'
            placeholder='No limit'
            value={draft}
            onChange={setEdit}
            disabled={credits.loading}
            error={
              valid ? undefined : 'Enter a whole number of credits, or leave blank for no limit.'
            }
            hint="Leave blank for no limit. Set in credits, Sim's usage unit (1,000 credits = $5), it caps this member's usage across this organization's workspaces each billing period."
          />
        </>
      )}
    </Modal>
  )
}
