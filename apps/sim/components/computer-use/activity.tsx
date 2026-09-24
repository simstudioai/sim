'use client'

import { Chip, toast } from '@sim/emcn'
import { getDesktopBridge } from '@/lib/desktop'
import { useComputerUseStatus } from '@/hooks/use-computer-use-status'

const ACTION_LABELS: Record<string, string> = {
  status: 'Checking permissions',
  list_apps: 'Finding apps',
  get_app_state: 'Reading',
  activate_app: 'Bringing app forward',
  click: 'Clicking',
  type_text: 'Typing',
  input_sequence: 'Entering text and keys',
  press_key: 'Pressing keys',
  scroll: 'Scrolling',
  drag: 'Dragging',
  set_value: 'Editing',
  perform_action: 'Interacting',
}

/** Remains visible while a native action is active, even if rollout or device access is revoked. */
export function ComputerUseActivity() {
  const { status } = useComputerUseStatus()
  const activity = status?.activeAction
  if (!activity) return null
  return (
    <div
      role='status'
      aria-live='polite'
      className='mb-2 flex cursor-default items-center justify-between gap-3 rounded-lg bg-[var(--surface-3)] px-3 py-2 text-sm'
    >
      <span className='truncate' title={activity.bundleId}>
        Computer Use · {activity.appName ?? 'Mac app'} ·{' '}
        {ACTION_LABELS[activity.action] ?? 'Working'}
      </span>
      <Chip
        title={activity.stopShortcutAvailable ? 'Stop computer use (⌘⇧Esc)' : 'Stop computer use'}
        aria-keyshortcuts={activity.stopShortcutAvailable ? 'Meta+Shift+Escape' : undefined}
        rightAdornment={
          activity.stopShortcutAvailable ? (
            <span aria-hidden='true'>
              <kbd>⌘⇧Esc</kbd>
            </span>
          ) : undefined
        }
        onClick={(event) => {
          event.stopPropagation()
          void getDesktopBridge()
            ?.computerUse?.cancel()
            .catch(() => toast.error('Could not stop computer use'))
        }}
      >
        Stop
      </Chip>
    </div>
  )
}
