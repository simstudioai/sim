'use client'

import {
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import { Lock } from '@sim/emcn/icons'
import type { TableLocks } from '@/lib/table'
import { lockedNouns } from '@/app/workspace/[workspaceId]/tables/[tableId]/lock-copy'

/**
 * Why the locked-table modal opened. `'status'` is the informational case (the
 * header lock chip); the rest are actions the user just tried and couldn't do.
 */
export type BlockedTableAction = 'add-row' | 'add-column' | 'edit-cell' | 'status'

/**
 * Copy for the action the user attempted. Explains what is blocked and — for
 * the append-only manual-entry case — what to do instead, since that one is
 * blocked by the *update* lock rather than the insert lock.
 */
function describe(action: BlockedTableAction, locks: TableLocks): { title: string; text: string } {
  switch (action) {
    case 'add-row':
      if (locks.insertLocked) {
        return {
          title: 'Adding rows is locked',
          text: 'New rows cannot be added to this table until an admin unlocks it.',
        }
      }
      return {
        title: 'This table is append-only',
        text: 'Rows here cannot be edited after they are added, so typing a new row in the grid is unavailable. Add rows by importing a CSV, or from the API, a workflow, or Sim.',
      }
    case 'add-column':
      return {
        title: 'Changing columns is locked',
        text: 'Columns cannot be added, renamed, retyped, or removed until an admin unlocks it.',
      }
    case 'edit-cell':
      return {
        title: 'Editing rows is locked',
        text: 'Existing cell values cannot be changed until an admin unlocks it. Workflow and enrichment columns still populate on their own.',
      }
    case 'status': {
      const nouns = lockedNouns(locks)
      return {
        title: 'Table locks',
        text:
          nouns.length > 0
            ? `An admin has locked ${nouns.join(', ')} on this table.`
            : 'Nothing is locked on this table.',
      }
    }
  }
}

interface TableLockedModalProps {
  /** The attempted action, or `null` when closed. */
  action: BlockedTableAction | null
  locks: TableLocks
  canAdmin: boolean
  onClose: () => void
  /** Opens the lock settings panel; only offered to admins. */
  onOpenLockSettings: () => void
}

/**
 * Explains why a table mutation is unavailable. Shown instead of silently
 * disabling the control, so the user learns the table is locked rather than
 * assuming the UI is broken — and admins get a direct route to the settings.
 */
export function TableLockedModal({
  action,
  locks,
  canAdmin,
  onClose,
  onOpenLockSettings,
}: TableLockedModalProps) {
  if (!action) return null
  const { title, text } = describe(action, locks)

  // Non-admins have nothing to act on, so this is a notice, not a decision — a
  // confirm modal would render two buttons that both just dismiss.
  if (!canAdmin) {
    return (
      <ChipModal open onOpenChange={(next) => !next && onClose()} srTitle={title}>
        <ChipModalHeader icon={Lock} onClose={onClose}>
          {title}
        </ChipModalHeader>
        <ChipModalBody>
          <p className='px-2 text-[var(--text-primary)] text-sm'>{text}</p>
        </ChipModalBody>
        <ChipModalFooter
          hideCancel
          onCancel={onClose}
          primaryAction={{ label: 'Got it', onClick: onClose }}
        />
      </ChipModal>
    )
  }

  return (
    <ChipConfirmModal
      open
      onOpenChange={(next) => !next && onClose()}
      title={title}
      icon={Lock}
      text={text}
      dismissLabel='Close'
      confirm={{
        label: 'Lock settings',
        // Navigational, not destructive — the confirm slot defaults to red.
        variant: 'primary',
        onClick: () => {
          onClose()
          onOpenLockSettings()
        },
      }}
    />
  )
}
