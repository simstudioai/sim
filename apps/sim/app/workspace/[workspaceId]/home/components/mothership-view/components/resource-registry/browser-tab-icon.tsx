'use client'

import { useState } from 'react'
import { cn } from '@sim/emcn'
import { CircleAlert, Globe, Loader } from '@sim/emcn/icons'
import { ThinkingLoader } from '@/components/ui'
import { browserTabHostname, shouldShowBrowserTabSpinner } from '@/lib/browser-agent/tab-label'
import { faviconUrl } from '@/lib/core/utils/favicon'
import { useBrowserSessionStore } from '@/stores/browser-session/store'

interface BrowserTabIconProps {
  /** Native tab id, which is also the browser resource's id. */
  tabId: string
  className?: string
}

/**
 * Resource-strip icon for one live browser page: its favicon while it has
 * one, a spinner while it is still loading without one, the globe otherwise.
 * While the agent is working in this tab the favicon gives way to the
 * thinking loader, so the strip shows where the agent is without pulling the
 * user's selection there.
 */
export function BrowserTabIcon({ tabId, className }: BrowserTabIconProps) {
  const tab = useBrowserSessionStore((state) => {
    const scopeId = state.activeScopeId
    return scopeId
      ? state.sessions[scopeId]?.tabs.find((entry) => entry.tabId === tabId)
      : undefined
  })
  const agentWorking = useBrowserSessionStore((state) => {
    const scopeId = state.activeScopeId
    const session = scopeId ? state.sessions[scopeId] : undefined
    return Boolean(
      session &&
        session.automationTabId === tabId &&
        (session.automationActive || session.agentRunIds.length > 0)
    )
  })
  const [loadedHostname, setLoadedHostname] = useState<string | null>(null)
  const [failedHostname, setFailedHostname] = useState<string | null>(null)

  const hostname = tab ? browserTabHostname(tab.url) : null
  const faviconLoaded = Boolean(hostname && loadedHostname === hostname)
  const faviconFailed = Boolean(hostname && failedHostname === hostname)
  const showSpinner = shouldShowBrowserTabSpinner(tab?.loading ?? false, hostname, loadedHostname)

  return (
    <span className={cn('relative flex items-center justify-center', className)}>
      {agentWorking ? (
        <ThinkingLoader size={14} startVariant='corners' />
      ) : tab?.issue ? (
        <CircleAlert className='size-[12px] text-[var(--text-icon)]' />
      ) : (
        <>
          {hostname && !faviconFailed && (
            <img
              key={hostname}
              src={faviconUrl(hostname, 32)}
              alt=''
              className={cn(
                'size-[16px] rounded-[3px]',
                !faviconLoaded && 'pointer-events-none absolute opacity-0'
              )}
              onLoad={() => setLoadedHostname(hostname)}
              onError={() => setFailedHostname(hostname)}
            />
          )}
          {showSpinner ? (
            <Loader
              animate
              className='size-[14px] text-[var(--text-icon)]'
              strokeWidth={2}
              style={{ animationDuration: '650ms' }}
            />
          ) : !faviconLoaded || faviconFailed ? (
            <Globe className='size-[12px] text-[var(--text-icon)]' />
          ) : null}
        </>
      )}
    </span>
  )
}
