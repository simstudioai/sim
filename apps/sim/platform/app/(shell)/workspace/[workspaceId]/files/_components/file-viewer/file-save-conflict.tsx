'use client'

import { Button } from '@sim/emcn/button'
import { InlineNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/file-save-conflict.module.css'
import { toast } from '@/platform/shared/toast'

interface FileSaveConflictProps {
  isReloading: boolean
  reloadLatestContent: () => Promise<void>
  downloadDraft: () => void
}

/** Keeps both versions recoverable until the reader chooses to replace the local draft. */
export function FileSaveConflict({
  isReloading,
  reloadLatestContent,
  downloadDraft,
}: FileSaveConflictProps) {
  return (
    <div className={styles.conflict}>
      <InlineNotice
        intent='warning'
        message='Saving paused: the file changed elsewhere. Your local draft is preserved. Reload replaces it with the latest version.'
        action={
          <>
            <Button variant='quiet' size='compact' onClick={downloadDraft}>
              Download local draft
            </Button>
            <Button
              variant='quiet'
              size='compact'
              disabled={isReloading}
              onClick={() => {
                void reloadLatestContent().catch((error) =>
                  toast.error(
                    getErrorMessage(
                      error,
                      'Could not reload the file. Your local draft is unchanged.'
                    )
                  )
                )
              }}
            >
              {isReloading ? 'Reloading…' : 'Discard draft and reload'}
            </Button>
          </>
        }
      />
    </div>
  )
}
