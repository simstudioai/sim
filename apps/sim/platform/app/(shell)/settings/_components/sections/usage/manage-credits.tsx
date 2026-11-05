'use client'

import { useState } from 'react'
import { QueryErrorState } from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import { CopyField, Modal, TextField } from '@/platform/design-system/components'
import { useMemberCredits } from '@/platform/lib/data/usage'

export interface CreditsTarget {
  userId: string
  name: string
}

/**
 * A member's credits used and their cap, blank for no limit. The draft seeds once, so a background
 * refetch cannot clobber an edit. Mount per member.
 */
export function ManageCredits({
  organizationId,
  member,
  onClose,
}: {
  organizationId: string
  member: CreditsTarget
  onClose: () => void
}) {
  const credits = useMemberCredits(organizationId, member.userId)
  const [edited, setEdited] = useState<string | null>(null)
  const saved = credits.data?.creditLimit ?? null
  const draft = edited ?? (saved === null ? '' : String(saved))
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={`Manage credits: ${member.name}`}
      confirmLabel='Save'
      confirmDisabled={credits.loading || credits.failed || edited === null}
      onConfirm={() => credits.save(draft)}
    >
      {credits.failed && (
        <QueryErrorState message='Couldn’t load this member’s limit.' onRetry={credits.retry} />
      )}
      <CopyField
        label={
          credits.data
            ? `Credits used this ${credits.data.billingInterval === 'year' ? 'year' : 'month'}`
            : 'Credits used'
        }
        value={credits.loading ? 'Loading…' : (credits.data?.creditsUsed.toLocaleString() ?? '—')}
      />
      <TextField
        label='Credit limit'
        inputMode='numeric'
        placeholder='No limit'
        hint="Leave blank for no limit. Set in credits, Sim's usage unit (1,000 credits = $5). Caps this member's usage across this organization's workspaces each billing period."
        disabled={credits.loading || credits.failed}
        value={draft}
        onChange={setEdited}
      />
    </Modal>
  )
}
