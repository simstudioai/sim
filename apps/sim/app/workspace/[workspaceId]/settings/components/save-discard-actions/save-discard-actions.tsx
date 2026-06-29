import { Chip } from '@sim/emcn'

interface SaveDiscardActionsProps {
  /** When false, renders nothing. */
  dirty: boolean
  /** A save is in flight — disables both chips and shows `savingLabel` on Save. */
  saving: boolean
  onSave: () => void
  onDiscard: () => void
  /** Disables Save independently of `saving` (e.g. validation errors, empty required field). */
  saveDisabled?: boolean
  savingLabel?: string
  saveLabel?: string
}

/**
 * The canonical dirty-gated Discard + Save chip pair for settings surfaces.
 * Renders nothing when not `dirty`; otherwise a fragment (no wrapper) so it
 * composes beside sibling chips in a `SettingsPanel` actions slot or a detail
 * header bar (e.g. group-detail's Delete, data-retention's Remove override).
 */
export function SaveDiscardActions({
  dirty,
  saving,
  onSave,
  onDiscard,
  saveDisabled = false,
  savingLabel = 'Saving...',
  saveLabel = 'Save',
}: SaveDiscardActionsProps) {
  if (!dirty) return null
  return (
    <>
      <Chip onClick={onDiscard} disabled={saving}>
        Discard
      </Chip>
      <Chip variant='primary' onClick={onSave} disabled={saving || saveDisabled}>
        {saving ? savingLabel : saveLabel}
      </Chip>
    </>
  )
}
