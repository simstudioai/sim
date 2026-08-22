'use client'

import { ChipLink, cn } from '@sim/emcn'
import { useSettingsHeader } from '@/components/settings/settings-header'

/** Stable identity: `useSettingsHeader` re-registers on every render it is given a new object. */
const EMPTY_HEADER = {}

interface SettingsUnavailableProps {
  title?: string
  description?: string
  embedded?: boolean
}

export function SettingsUnavailable({
  title = 'Settings unavailable',
  description = 'You do not have access to manage this organization. Contact an organization owner or admin for help.',
  embedded = false,
}: SettingsUnavailableProps) {
  /**
   * Claims the header with nothing in it.
   *
   * This surface renders its own centered heading, and the settings shell otherwise falls back
   * to the routed section's catalog title — which would caption a "you do not have access"
   * body with the very setting being denied, Docs link and all. Claiming an empty header is
   * how a body opts out of that fallback. Outside a settings shell (the organization layout
   * renders this in place of the shell) there is no registrar and this is a no-op.
   */
  useSettingsHeader(EMPTY_HEADER)

  return (
    <div
      className={cn(
        'flex w-full items-center justify-center bg-[var(--surface-1)] p-6',
        embedded ? 'h-full' : 'h-screen'
      )}
    >
      <div className='flex max-w-md flex-col items-center gap-3 text-center'>
        <h1 className='text-[var(--text-body)] text-lg'>{title}</h1>
        <p className='text-[var(--text-muted)] text-sm'>{description}</p>
        <ChipLink href='/workspace'>Back to workspaces</ChipLink>
      </div>
    </div>
  )
}
