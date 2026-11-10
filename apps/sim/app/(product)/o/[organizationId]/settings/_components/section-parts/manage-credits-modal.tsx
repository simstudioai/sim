'use client'

import { useState } from 'react'
import { TextField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { FailureNotice } from '@sim/emcn/status'
import { useMemberCredits } from '@/platform/lib/data/members'
import { LOCALE } from '@/platform/shared/time'

export interface CreditsTarget {
  userId: string
  name: string
}

interface ManageCreditsModalProps {
  member: CreditsTarget
  onClose: () => void
}

/**
 * A member's credits used and their cap, blank for no limit. The draft seeds from the loaded limit
 * until the admin types, so a refetch can't clobber an edit. Mount per member.
 */
export function ManageCreditsModal({ member, onClose }: ManageCreditsModalProps) {
  const credits = useMemberCredits(member.userId)
  const [edit, setEdit] = useState<string | null>(null)
  const saved = credits.usage?.creditLimit ?? null
  const draft = edit ?? (saved === null ? '' : String(saved))
  const trimmed = draft.trim()
  const limit = trimmed === '' ? null : Number(trimmed)
  const valid = limit === null || (Number.isInteger(limit) && limit >= 0)
  const { usage } = credits
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={`Manage credits: ${member.name}`}
      confirmLabel='Save'
      confirmDisabled={!usage || !valid || limit === saved}
      onConfirm={() => credits.save(limit)}
    >
      {credits.error && !usage ? (
        <FailureNotice
          title='Could not load credit usage'
          message={credits.error.message}
          onRetry={credits.retry}
        />
      ) : (
        <>
          <TextField
            placeholder='Credits used'
            label={
              usage
                ? `Credits used this ${usage.billingInterval === 'year' ? 'year' : 'month'}`
                : 'Credits used'
            }
            value={usage?.creditsUsed.toLocaleString(LOCALE) ?? ''}
            readOnly
          />
          <TextField
            label='Credit limit'
            inputMode='numeric'
            placeholder='No limit'
            value={draft}
            onChange={setEdit}
            disabled={!usage}
            error={
              valid ? undefined : 'Enter a whole number of credits, or leave blank for no limit.'
            }
          />
        </>
      )}
    </Modal>
  )
}
