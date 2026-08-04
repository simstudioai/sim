import { type SettingsAction, SettingsActionChips } from '@/components/settings/settings-header'

export interface SaveDiscardActionsConfig {
  dirty: boolean
  saving: boolean
  onSave: () => void
  onDiscard: () => void
  saveDisabled?: boolean
  /** Labels the primary action `Create` / `Creating...` instead of `Save` / `Saving...`. */
  creating?: boolean
  /** Bespoke wording (e.g. `Update`). Prefer `creating` for the standard create flow. */
  saveLabel?: string
  /** Bespoke in-flight wording. Pair it with `saveLabel` so the two can't drift. */
  savingLabel?: string
  /** Explains a `saveDisabled` Save on hover — Save is always visible, so a blocked one should say why. */
  saveTooltip?: string
}

/**
 * The canonical Save/Discard header actions for any editable surface.
 *
 * Save is always rendered — every editable surface announces its primary action
 * in the same place, and a create form is never a page with no visible way to
 * commit it — and is disabled until there is something to save. Discard only
 * appears once there is something to discard.
 */
export function saveDiscardActions({
  dirty,
  saving,
  onSave,
  onDiscard,
  saveDisabled = false,
  creating = false,
  saveLabel = creating ? 'Create' : 'Save',
  savingLabel = creating ? 'Creating...' : 'Saving...',
  saveTooltip,
}: SaveDiscardActionsConfig): SettingsAction[] {
  return [
    ...(dirty ? [{ id: 'discard', text: 'Discard', onSelect: onDiscard, disabled: saving }] : []),
    {
      id: 'save',
      text: saving ? savingLabel : saveLabel,
      variant: 'primary',
      onSelect: onSave,
      disabled: saving || saveDisabled || !dirty,
      tooltip: saveTooltip,
    },
  ]
}

/**
 * {@link saveDiscardActions} rendered as chips, for surfaces whose header takes
 * a `ReactNode` (`CredentialDetailLayout`) instead of the settings shell's
 * action data. Both stacks derive their chips from the one rule above.
 */
export function SaveDiscardChips(config: SaveDiscardActionsConfig) {
  return <SettingsActionChips actions={saveDiscardActions(config)} />
}
