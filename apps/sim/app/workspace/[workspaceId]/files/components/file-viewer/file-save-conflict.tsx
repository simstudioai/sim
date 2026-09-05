'use client'

import { Chip, toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'

interface FileSaveConflictProps {
  isReloading: boolean
  reloadLatestContent: () => Promise<void>
  downloadDraft: () => void
}

/** Keeps both versions recoverable until the user explicitly replaces the local draft. */
export function FileSaveConflict({
  isReloading,
  reloadLatestContent,
  downloadDraft,
}: FileSaveConflictProps) {
  return (
    <div
      role='alert'
      className='flex shrink-0 flex-wrap items-center gap-2 border-[var(--border)] border-b px-4 py-2 text-[13px] text-[var(--text-body)]'
    >
      <p className='min-w-0 flex-1'>
        Saving paused: the file changed elsewhere. Your local draft is preserved. Reload replaces it
        with the latest version.
      </p>
      <Chip onClick={downloadDraft}>Download local draft</Chip>
      <Chip
        disabled={isReloading}
        onClick={() => {
          void reloadLatestContent().catch((error) =>
            toast.error(
              getErrorMessage(error, 'Could not reload the file. Your local draft is unchanged.')
            )
          )
        }}
      >
        {isReloading ? 'Reloading…' : 'Discard draft and reload'}
      </Chip>
    </div>
  )
}
