'use client'

import { SaveActions } from '@sim/emcn/settings-section/save-actions'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'

interface SettingsSaveBarProps {
  dirty: boolean
  saving: boolean
  /** Save cannot run for a reason the page already shows, such as a field's error. */
  blocked?: boolean
  /** Why Save is blocked, for a reason the page does not already show. Set only while blocked: Save is disabled whenever it is set. */
  blockedReason?: string
  /** Omitted inside a `<form>` that owns validation: Save then submits it. */
  onSave?: () => void
  onDiscard: () => void
}

/**
 * The one way a settings draft is committed: `SaveActions` (Discard while dirty, then Save,
 * end-aligned under the fields) plus the draft's registration with the Settings leave guard, so
 * leaving with unsaved changes asks first and a pending save holds navigation. A sub-view's back
 * action leaves through `requestSettingsLeave`, which asks the same guard. Create forms keep their
 * own submit button (Create {noun}, Add {noun}): Save is the only label this bar has.
 */
export function SettingsSaveBar({
  dirty,
  saving,
  blocked,
  blockedReason,
  onSave,
  onDiscard,
}: SettingsSaveBarProps) {
  useSettingsUnsavedGuard({ isDirty: dirty, navigationBlocked: saving, onDiscard })
  return (
    <SaveActions
      dirty={dirty}
      saving={saving}
      blocked={blocked}
      blockedReason={blockedReason}
      onSave={onSave}
      onDiscard={onDiscard}
    />
  )
}
