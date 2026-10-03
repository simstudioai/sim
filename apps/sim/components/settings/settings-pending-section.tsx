'use client'

import type { ReactNode } from 'react'
import {
  type SettingsHeaderMeta,
  SettingsHeaderProvider,
  SettingsHeaderShell,
} from '@/components/settings/settings-header'
import { useSettingsNavigationState } from '@/components/settings/settings-navigation-provider'

interface SettingsPendingSectionProps {
  /** The header a pending section paints with, or null to keep showing the current section. */
  resolveMeta: (section: string) => SettingsHeaderMeta | null
  children: ReactNode
}

/**
 * Paints a clicked section's heading over an empty body while its route resolves — the same frame
 * the route commits with, minus the body — so the click lands immediately. The current section
 * stays mounted and laid out underneath, invisible and inert, so its scroll position and state are
 * intact if the navigation settles back on it. With nothing pending both wrappers are
 * `display: contents` and add no box of their own.
 */
export function SettingsPendingSection({ resolveMeta, children }: SettingsPendingSectionProps) {
  const { pendingSection } = useSettingsNavigationState()
  const pendingMeta = pendingSection ? resolveMeta(pendingSection) : null

  return (
    <div className={pendingMeta ? 'relative flex h-full min-h-0 flex-col' : 'contents'}>
      {pendingMeta && (
        <div className='absolute inset-0 z-10 bg-[var(--bg)]'>
          <SettingsHeaderProvider>
            <SettingsHeaderShell meta={pendingMeta}>{null}</SettingsHeaderShell>
          </SettingsHeaderProvider>
        </div>
      )}
      <div
        className={pendingMeta ? 'invisible flex h-full min-h-0 flex-col' : 'contents'}
        inert={pendingMeta ? true : undefined}
      >
        {children}
      </div>
    </div>
  )
}
