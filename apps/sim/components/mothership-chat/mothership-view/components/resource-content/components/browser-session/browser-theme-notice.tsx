'use client'

import { useState } from 'react'
import { Chip } from '@sim/emcn-legacy'
import { X } from '@sim/emcn-legacy/icons'
import { BrowserNotice } from '@/components/mothership-chat/mothership-view/components/resource-content/components/browser-session/browser-notice'
import { sendBrowserPanelAction } from '@/lib/browser-agent/transport'

interface BrowserThemeNoticeProps {
  scopeId: string
}

/** Temporary theme helper while the browser theme interaction is being refined. */
export function BrowserThemeNotice({ scopeId }: BrowserThemeNoticeProps) {
  const [visible, setVisible] = useState(true)

  if (!visible) return null

  return (
    <BrowserNotice
      message='Some sites apply theme changes after a reload.'
      actions={
        <>
          <Chip onClick={() => sendBrowserPanelAction('reload', {}, scopeId)}>Reload page</Chip>
          <Chip leftIcon={X} aria-label='Dismiss theme notice' onClick={() => setVisible(false)} />
        </>
      }
    />
  )
}
