'use client'

import { useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipSwitch,
} from '@/components/emcn'
import { Link } from '@/components/emcn/icons'
import type { ShareRecord } from '@/lib/api/contracts/public-shares'
import { useFileShare, useUpsertFileShare } from '@/hooks/queries/public-shares'

interface ShareModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  fileId: string
  fileName: string
  /** Share state already known from the file row, used as the initial value to avoid flicker. */
  initialShare?: ShareRecord | null
}

const VISIBILITY_OPTIONS = [
  { value: 'private', label: 'Private' },
  { value: 'public', label: 'Anyone with link' },
]

export function ShareModal({
  open,
  onOpenChange,
  workspaceId,
  fileId,
  fileName,
  initialShare,
}: ShareModalProps) {
  const { data: share } = useFileShare(workspaceId, fileId, { enabled: open })
  const upsertShare = useUpsertFileShare()

  const saved = share ?? initialShare ?? null
  const savedActive = saved?.isActive ?? false

  const [draftActive, setDraftActive] = useState(initialShare?.isActive ?? false)
  const isDirty = draftActive !== savedActive

  const handleSave = () => {
    upsertShare.mutate(
      { workspaceId, fileId, isActive: draftActive },
      { onSuccess: () => onOpenChange(false) }
    )
  }

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} size='sm' srTitle={`Share ${fileName}`}>
      <ChipModalHeader icon={Link} onClose={() => onOpenChange(false)}>
        Share file
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='custom'
          title='Access'
          hint={
            draftActive
              ? isDirty
                ? 'Save to make this file accessible to anyone with the link.'
                : 'Anyone with the link can view and download this file.'
              : 'Only workspace members can access this file.'
          }
        >
          <ChipSwitch
            value={draftActive ? 'public' : 'private'}
            onChange={(value) => setDraftActive(value === 'public')}
            options={VISIBILITY_OPTIONS}
            aria-label='File access'
          />
        </ChipModalField>
        {saved?.isActive ? (
          <ChipModalField type='copy' title='Link' value={saved.url} copyLabel='Copy link' />
        ) : null}
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        primaryAction={{
          label: upsertShare.isPending ? 'Saving...' : 'Save',
          onClick: handleSave,
          disabled: !isDirty || upsertShare.isPending,
        }}
      />
    </ChipModal>
  )
}
