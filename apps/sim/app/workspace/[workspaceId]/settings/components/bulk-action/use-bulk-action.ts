'use client'

import { useState } from 'react'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import type {
  BulkActionCopy,
  BulkActionDialogProps,
} from '@/app/workspace/[workspaceId]/settings/components/bulk-action/bulk-action'

const RETRY_HINT = 'Please try again in a moment.'

interface BulkActionConfig<T> {
  copy: BulkActionCopy
  /** Rows the confirmed action targets, in the order it should run them. */
  rows: T[]
  /** Runs the action for one row. A rejection is collected, never fatal to the batch. */
  perform: (row: T) => Promise<unknown>
  /**
   * Runs once the batch settles either way — clear the selection here. Receives
   * the rows that actually succeeded, so a caller can react to what is now gone
   * (navigating away when the batch deleted the page's own ground) rather than
   * assuming the whole selection went through.
   */
  onSettled?: (outcome: { succeeded: T[] }) => void
}

interface BulkAction {
  /** Opens the confirmation. Wire to the `...` menu row. */
  confirm: () => void
  /** Spread onto {@link BulkActionDialog}. */
  dialogProps: BulkActionDialogProps
}

/**
 * Runs a table's bulk action over the selected rows behind one confirmation.
 *
 * Rows go **sequentially** because these routes each take one row, and a
 * failure is **collected rather than fatal**: a row the server refuses — a race
 * with someone else's edit, a guard that only applies to that row — must not
 * strand the rest of the batch. The selection is cleared either way, so a
 * partial success cannot leave the rows that already succeeded still ticked.
 *
 * The pending flag spans the whole batch, which a mutation's own `isPending`
 * does not: that drops between two sequential calls, briefly re-enabling the
 * confirm button mid-run.
 *
 * @example
 * ```tsx
 * const bulk = useBulkAction({
 *   copy: DELETE_WORKSPACES_COPY,
 *   rows: selectedRows,
 *   perform: (row) => deleteWorkspace.mutateAsync({ workspaceId: row.id }),
 *   onSettled: () => setSelection([]),
 * })
 * // …
 * <BulkActionMenu copy={copy} disabled={!selectedRows.length} onSelect={bulk.confirm} />
 * <BulkActionDialog {...bulk.dialogProps} />
 * ```
 */
export function useBulkAction<T>({
  copy,
  rows,
  perform,
  onSettled,
}: BulkActionConfig<T>): BulkAction {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [isRunning, setIsRunning] = useState(false)

  const run = async () => {
    if (isRunning || rows.length === 0) return
    setIsRunning(true)

    const failures: string[] = []
    const succeeded: T[] = []
    for (const row of rows) {
      try {
        await perform(row)
        succeeded.push(row)
      } catch (error) {
        failures.push(getErrorMessage(error, RETRY_HINT))
      }
    }

    const attempted = rows.length
    setIsRunning(false)
    setIsConfirmOpen(false)
    onSettled?.({ succeeded })

    if (failures.length > 0) {
      toast.error(copy.failed(failures.length, attempted), { description: failures[0] })
      return
    }
    toast.success(copy.succeeded(attempted))
  }

  return {
    confirm: () => setIsConfirmOpen(true),
    dialogProps: {
      open: isConfirmOpen,
      onOpenChange: setIsConfirmOpen,
      copy,
      count: rows.length,
      isSubmitting: isRunning,
      onConfirm: () => void run(),
    },
  }
}
