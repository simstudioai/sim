'use client'

import { useRef, useState } from 'react'
import {
  Chip,
  ChipTag,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  toast,
} from '@sim/emcn'
import { MoreHorizontal } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import Link from 'next/link'
import type { ChangelogRelease } from '@/lib/api/contracts/changelog'
import { ReleaseWorkflows } from '@/app/workspace/[workspaceId]/changelog/components/release-workflows/release-workflows'
import { FileViewer } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import { useAddressedWorkspaceFileRecord } from '@/hooks/queries/workspace-files'

interface ReleaseEntryProps {
  workspaceId: string
  release: ChangelogRelease
  canEdit: boolean
  onEditDetails: (release: ChangelogRelease) => void
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })

/** One shipped release: the date and version rail, then its title, body, and change lines. */
export function ReleaseEntry({ workspaceId, release, canEdit, onEditDetails }: ReleaseEntryProps) {
  const saveRef = useRef<(() => Promise<void>) | null>(null)
  const saveFailedRef = useRef(false)
  const [editingBody, setEditingBody] = useState(false)
  const [savingBody, setSavingBody] = useState(false)
  const file = useAddressedWorkspaceFileRecord(workspaceId, release.fileId)

  return (
    <article className='grid @min-[760px]/changelog:grid-cols-[132px_minmax(0,1fr)] grid-cols-1 gap-x-10 gap-y-3 border-[var(--border)] border-t pt-12 first:border-t-0 first:pt-0'>
      <aside className='@min-[760px]/changelog:sticky top-8 flex h-fit flex-col gap-2'>
        <span className='text-[var(--text-primary)] text-md'>
          {DATE_FORMAT.format(new Date(release.publishedAt))}
        </span>
        <div>
          <ChipTag variant='gray'>{`v${release.version}`}</ChipTag>
        </div>
        <ReleaseWorkflows workspaceId={workspaceId} workflows={release.workflows} />
      </aside>

      <div className='flex min-w-0 flex-col gap-6'>
        <div className='flex items-start gap-3'>
          <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
            <h2 className='text-[var(--text-primary)] text-lg leading-tight'>{release.title}</h2>
            <p className='text-[var(--text-muted)] text-small'>{release.bumpReason}</p>
          </div>
          {canEdit &&
            (editingBody ? (
              <Chip
                variant='primary'
                disabled={savingBody}
                onClick={async () => {
                  setSavingBody(true)
                  saveFailedRef.current = false
                  try {
                    await saveRef.current?.()
                  } catch (error) {
                    if (!saveFailedRef.current)
                      toast.error(getErrorMessage(error, 'Failed to save notes'))
                    saveFailedRef.current = true
                  } finally {
                    setSavingBody(false)
                  }
                  if (!saveFailedRef.current) setEditingBody(false)
                }}
              >
                {savingBody ? 'Saving...' : 'Done'}
              </Chip>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Chip aria-label={`Actions for ${release.title}`}>
                    <MoreHorizontal className='size-[14px] text-[var(--text-icon)]' />
                  </Chip>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  <DropdownMenuItem onSelect={() => setEditingBody(true)}>
                    Edit notes
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onEditDetails(release)}>
                    Edit title and version
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ))}
        </div>

        {file.error ? (
          <p role='alert' className='text-[var(--text-error)] text-small'>
            {file.error.message}
          </p>
        ) : file.data ? (
          <div
            className={cn(editingBody ? 'rounded-lg border border-[var(--border)]' : '-mx-8 -my-6')}
          >
            <FileViewer
              key={`${file.data.id}:${editingBody}`}
              file={file.data}
              workspaceId={workspaceId}
              canEdit={editingBody}
              readOnly={!editingBody}
              saveRef={saveRef}
              onSaveError={(error) => {
                saveFailedRef.current = true
                toast.error(getErrorMessage(error, 'Failed to save notes'))
              }}
            />
          </div>
        ) : null}

        {release.changes.length > 0 && (
          <ul className='flex flex-col gap-2.5'>
            {release.changes.map((change) => (
              <li key={change.id} className='flex gap-3'>
                <span className='mt-[9px] size-[5px] shrink-0 rounded-full bg-[var(--text-icon)]' />
                {change.chatId ? (
                  <Link
                    href={`/workspace/${workspaceId}/chat/${change.chatId}`}
                    className='min-w-0 flex-1 text-[var(--text-body)] text-md underline-offset-4 hover:underline'
                  >
                    {change.text}
                  </Link>
                ) : (
                  <span className='min-w-0 flex-1 text-[var(--text-body)] text-md'>
                    {change.text}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  )
}
