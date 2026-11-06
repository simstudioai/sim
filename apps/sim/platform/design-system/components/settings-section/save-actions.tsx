'use client'

import { Button } from '@/platform/design-system/components/button/button'
import styles from '@/platform/design-system/components/settings-section/settings-section.module.css'
import { Tooltip } from '@/platform/design-system/components/tooltip/tooltip'

interface SaveActionsProps {
  dirty: boolean
  saving?: boolean
  /** Nothing to do with the edit itself: a choice still owed, or a value that cannot be sent. */
  blocked?: boolean
  /** Why Save is blocked, for a reason the page does not already show. */
  blockedReason?: string
  /** Submits the surrounding form instead, for a form that owns validation. */
  onSave?: () => void
  onDiscard: () => void
}

/**
 * The one way an explicit edit is committed, end-aligned under the fields it commits: Discard while
 * something is unsaved, then Save. Save stays visible but disabled while nothing has changed.
 */
export function SaveActions({
  dirty,
  saving = false,
  blocked = false,
  blockedReason,
  onSave,
  onDiscard,
}: SaveActionsProps) {
  return (
    <div className={styles.saveActions}>
      {dirty && (
        <Button disabled={saving} onClick={onDiscard}>
          Discard
        </Button>
      )}
      <Tooltip label={blockedReason ?? ''} enabled={Boolean(blockedReason)}>
        <span>
          <Button
            variant='primary'
            submit={!onSave}
            disabled={!dirty || saving || blocked || Boolean(blockedReason)}
            onClick={onSave}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </span>
      </Tooltip>
    </div>
  )
}
