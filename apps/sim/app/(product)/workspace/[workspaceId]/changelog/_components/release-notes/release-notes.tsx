'use client'

import { InlineNotice } from '@sim/emcn/status'
import { RichMarkdownField } from '@/components/file-viewer/rich-markdown-editor/rich-markdown-field'
import { DetailSection } from '@/app/(product)/workspace/[workspaceId]/_components/detail-split/detail-split'
import styles from '@/app/(product)/workspace/[workspaceId]/changelog/_components/release-notes/release-notes.module.css'
import { useReleaseNotes } from '@/platform/lib/data/changelog'

function readOnly() {}

interface ReleaseNotesProps {
  workspaceId: string
  fileId: string
}

/** A release's notes, read-only; they are edited as their file in Files. */
export function ReleaseNotes({ workspaceId, fileId }: ReleaseNotesProps) {
  const notes = useReleaseNotes(workspaceId, fileId)
  if (notes.missing)
    return <InlineNotice intent='danger' message='The notes file for this release was deleted.' />
  if (notes.error) return <InlineNotice intent='danger' message={notes.error.message} />
  if (notes.content === undefined) return null
  return (
    <DetailSection title='Notes'>
      <div className={styles.notes} data-type='T048'>
        <RichMarkdownField
          key={notes.content}
          value={notes.content}
          onChange={readOnly}
          placeholder='No notes'
          editable={false}
        />
      </div>
    </DetailSection>
  )
}
