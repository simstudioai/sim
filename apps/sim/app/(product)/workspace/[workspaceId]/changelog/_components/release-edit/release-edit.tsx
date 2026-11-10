'use client'

import { useState } from 'react'
import { TextAreaField, TextField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { type ReleaseFields, useReleaseEdit } from '@/platform/lib/data/changelog'

interface ReleaseEditProps {
  workspaceId: string
  release: ReleaseFields
  onOpenChange: (open: boolean) => void
}

/** Edits a release's title, version label and reason under the revision it was read at; open while mounted. */
export function ReleaseEdit({ workspaceId, release, onOpenChange }: ReleaseEditProps) {
  const [title, setTitle] = useState(release.title)
  const [version, setVersion] = useState(release.version)
  const [bumpReason, setBumpReason] = useState(release.bumpReason)
  const edit = useReleaseEdit(workspaceId)
  const unchanged =
    title === release.title && version === release.version && bumpReason === release.bumpReason
  const empty = !title.trim() || !version.trim() || !bumpReason.trim()
  return (
    <Modal
      open
      onOpenChange={onOpenChange}
      title='Edit release'
      confirmLabel={edit.isPending ? 'Saving…' : 'Save'}
      confirmDisabled={unchanged || empty}
      pending={edit.isPending}
      onConfirm={() =>
        edit.mutateAsync({
          releaseId: release.id,
          expectedRevision: release.revision,
          ...(title !== release.title ? { title } : {}),
          ...(version !== release.version ? { version } : {}),
          ...(bumpReason !== release.bumpReason ? { bumpReason } : {}),
        })
      }
    >
      <TextField
        label='Title'
        value={title}
        onChange={setTitle}
        placeholder='What this release does'
        maxLength={200}
        required
      />
      <TextField
        label='Version'
        value={version}
        onChange={setVersion}
        placeholder='1.4.0'
        maxLength={40}
        autoComplete='off'
        required
      />
      <TextAreaField
        label='Why this version'
        value={bumpReason}
        onChange={setBumpReason}
        placeholder='Why this is a major, minor or patch release'
        maxLength={500}
        required
      />
    </Modal>
  )
}
