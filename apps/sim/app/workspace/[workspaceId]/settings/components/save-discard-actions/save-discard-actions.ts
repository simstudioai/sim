import type { SettingsAction } from '@/app/workspace/[workspaceId]/settings/components/settings-header/settings-header'

interface SaveDiscardActionsConfig {
  dirty: boolean
  saving: boolean
  onSave: () => void
  onDiscard: () => void
  saveDisabled?: boolean
  savingLabel?: string
  saveLabel?: string
}

/** The dirty-gated Discard + Save action pair for settings surfaces — empty when not dirty. */
export function saveDiscardActions({
  dirty,
  saving,
  onSave,
  onDiscard,
  saveDisabled = false,
  savingLabel = 'Saving...',
  saveLabel = 'Save',
}: SaveDiscardActionsConfig): SettingsAction[] {
  if (!dirty) return []
  return [
    { text: 'Discard', onSelect: onDiscard, disabled: saving },
    {
      text: saving ? savingLabel : saveLabel,
      variant: 'primary',
      onSelect: onSave,
      disabled: saving || saveDisabled,
    },
  ]
}
