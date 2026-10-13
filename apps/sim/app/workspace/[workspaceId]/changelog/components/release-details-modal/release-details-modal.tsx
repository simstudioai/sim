'use client'

import { useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import type { ChangelogRelease } from '@/lib/api/contracts/changelog'
import { useUpdateChangelogRelease } from '@/hooks/queries/changelog'

interface ReleaseDetailsModalProps {
  workspaceId: string
  release: ChangelogRelease
  onClose: () => void
}

/** Edits a release's title, version label, and bump reason under its revision. */
export function ReleaseDetailsModal({ workspaceId, release, onClose }: ReleaseDetailsModalProps) {
  const [title, setTitle] = useState(release.title)
  const [version, setVersion] = useState(release.version)
  const [bumpReason, setBumpReason] = useState(release.bumpReason)
  const update = useUpdateChangelogRelease(workspaceId)

  const save = () =>
    update.mutate(
      {
        releaseId: release.id,
        expectedRevision: release.revision,
        ...(title !== release.title ? { title } : {}),
        ...(version !== release.version ? { version } : {}),
        ...(bumpReason !== release.bumpReason ? { bumpReason } : {}),
      },
      { onSuccess: onClose }
    )

  const unchanged =
    title === release.title && version === release.version && bumpReason === release.bumpReason
  const empty = !title.trim() || !version.trim() || !bumpReason.trim()

  return (
    <ChipModal open onOpenChange={(open) => !open && onClose()} srTitle='Edit release'>
      <ChipModalHeader onClose={onClose}>Edit release</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='input'
          title='Title'
          value={title}
          onChange={setTitle}
          maxLength={200}
          required
          disabled={update.isPending}
        />
        <ChipModalField
          type='input'
          title='Version'
          value={version}
          onChange={setVersion}
          placeholder='1.4.0'
          maxLength={40}
          autoComplete='off'
          required
          disabled={update.isPending}
        />
        <ChipModalField
          type='textarea'
          title='Why this version'
          value={bumpReason}
          onChange={setBumpReason}
          rows={3}
          maxLength={500}
          required
          disabled={update.isPending}
        />
        <ChipModalError>{update.error?.message}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
        cancelDisabled={update.isPending}
        primaryAction={{
          label: update.isPending ? 'Saving...' : 'Save',
          onClick: save,
          disabled: update.isPending || unchanged || empty,
        }}
      />
    </ChipModal>
  )
}
