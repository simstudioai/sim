import { ChipConfirmModal } from '@sim/emcn'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'

/**
 * Everything one bulk action says about itself, in one place: the menu row that
 * opens it, the confirmation it opens, and the toast that reports the result.
 *
 * Splitting this across call sites is how a single action ends up called
 * "Revoke invites" in the menu, "Revoke invitations" in the modal, and
 * "Cancelled" in the toast.
 */
export interface BulkActionCopy {
  /** Names the action everywhere it appears: menu row, confirmation title, confirm button. */
  title: string
  /** Accessible name of the `...` trigger standing over the current selection. */
  triggerLabel: string
  /** Confirm-button label while the batch runs. */
  pendingLabel: string
  /** Pluralized row count — `1 member`, `3 workspaces`. */
  count: (rows: number) => string
  /** The verb before the bolded count — `Remove `, `Delete `, `Revoke `. */
  lead: string
  /** Everything after the bolded count, its punctuation included. */
  consequence: string
  /** Toast headline once every row succeeded. */
  succeeded: (rows: number) => string
  /** Toast headline when some rows failed. */
  failed: (failures: number, rows: number) => string
}

interface BulkActionMenuProps {
  copy: BulkActionCopy
  /** True when nothing is selected — the menu stays put and disables itself. */
  disabled: boolean
  onSelect: () => void
}

/**
 * The `...` that stands over a table's current selection.
 *
 * Always mounted, never conditional on the selection being non-empty: a control
 * that appears on first tick is undiscoverable, and its slot reflows the
 * select-all band as it comes and goes.
 */
export function BulkActionMenu({ copy, disabled, onSelect }: BulkActionMenuProps) {
  return (
    <RowActionsMenu
      label={copy.triggerLabel}
      disabled={disabled}
      actions={[{ label: copy.title, destructive: true, onSelect }]}
    />
  )
}

export interface BulkActionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  copy: BulkActionCopy
  /** How many rows the confirmed action will target. */
  count: number
  isSubmitting: boolean
  onConfirm: () => void
}

/**
 * Confirms a table's bulk action. One surface for all of them — the wording is
 * the only thing that varies, and it arrives as {@link BulkActionCopy}.
 *
 * Bulk removal states its consequence in general terms. Where a single-row flow
 * can disclose more (the members page fetches the exact credentials a removal
 * breaks), that flow keeps its own dialog rather than fetching an impact report
 * per selected row.
 */
export function BulkActionDialog({
  open,
  onOpenChange,
  copy,
  count,
  isSubmitting,
  onConfirm,
}: BulkActionDialogProps) {
  return (
    <ChipConfirmModal
      open={open}
      onOpenChange={onOpenChange}
      srTitle={copy.title}
      title={copy.title}
      text={[copy.lead, { text: copy.count(count), bold: true }, copy.consequence]}
      confirm={{
        label: copy.title,
        onClick: onConfirm,
        pending: isSubmitting,
        pendingLabel: copy.pendingLabel,
      }}
    />
  )
}
