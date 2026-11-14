'use client'

import {
  isQuickChatShortcut,
  QUICK_CHAT_SHORTCUTS,
  type QuickChatShortcut,
} from '@sim/desktop-bridge'
import { ChipSelect } from '@sim/emcn'
import { isMacPlatform } from '@/lib/core/utils/platform'

const MAC_LABELS: Record<QuickChatShortcut, string> = {
  'Alt+Space': '⌥ Space',
  'CommandOrControl+Shift+Space': '⇧⌘ Space',
  'CommandOrControl+Shift+J': '⇧⌘J',
}

const OFF = 'off'

interface QuickChatShortcutSelectProps {
  value: QuickChatShortcut | null
  onChange: (value: QuickChatShortcut | null) => void
  disabled?: boolean
}

/** Picks the global shortcut for the desktop quick chat window, or turns it off. */
export function QuickChatShortcutSelect({
  value,
  onChange,
  disabled,
}: QuickChatShortcutSelectProps) {
  const mac = isMacPlatform()
  return (
    <div className='w-[240px] max-w-[55%] shrink-0 md:max-w-none'>
      <ChipSelect
        aria-label='Quick chat shortcut'
        align='start'
        fullWidth
        dropdownWidth='trigger'
        value={value ?? OFF}
        onChange={(next) => onChange(isQuickChatShortcut(next) ? next : null)}
        disabled={disabled}
        options={[
          { label: 'Off', value: OFF },
          ...QUICK_CHAT_SHORTCUTS.map((shortcut) => ({
            label: mac ? MAC_LABELS[shortcut] : shortcut.replace('CommandOrControl', 'Ctrl'),
            value: shortcut,
          })),
        ]}
      />
    </div>
  )
}
