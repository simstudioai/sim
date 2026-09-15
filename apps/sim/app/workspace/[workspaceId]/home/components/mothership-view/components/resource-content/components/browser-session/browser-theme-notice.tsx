'use client'

import { useState } from 'react'
import { Banner, Chip } from '@sim/emcn'
import { X } from '@sim/emcn/icons'
import { sendBrowserPanelAction } from '@/lib/browser-agent/transport'

interface BrowserThemeNoticeProps {
  scopeId: string
}

/** Temporary theme helper while the browser theme interaction is being refined. */
export function BrowserThemeNotice({ scopeId }: BrowserThemeNoticeProps) {
  const [visible, setVisible] = useState(true)

  if (!visible) return null

  return (
    <Banner className='border-[var(--border)] border-t bg-[var(--surface-3)] px-3 py-1.5'>
      <div className='flex items-center justify-between gap-3'>
        <p className='text-[13px] text-[var(--text-secondary)]'>
          Some sites apply theme changes after a reload.
        </p>
        <div className='flex shrink-0 items-center gap-0.5'>
          <Chip onClick={() => sendBrowserPanelAction('reload', {}, scopeId)}>Reload page</Chip>
          <Chip leftIcon={X} aria-label='Dismiss theme notice' onClick={() => setVisible(false)} />
        </div>
      </div>
    </Banner>
  )
}
