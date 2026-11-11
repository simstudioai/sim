'use client'

import { useState } from 'react'
import { cn } from '@sim/emcn-legacy'
import { CircleAlert, Globe, Loader } from '@sim/emcn-legacy/icons'
import { Favicon } from '@/components/favicon/favicon'
import { ThinkingLoader } from '@/components/ui'
import { shouldShowBrowserTabSpinner } from '@/lib/browser-agent/tab-label'
import { siteHost } from '@/lib/favicon/url'
import { useBrowserSessionStore } from '@/stores/browser-session/store'

interface BrowserTabIconProps {
  /** Native tab id, which is also the browser resource's id. */
  tabId: string
  /** Desktop browser scope the tab lives in; without one the icon is a plain globe. */
  scopeId?: string
  className?: string
}

/**
 * Resource-strip icon for one live browser page: its favicon while it has
 * one, a spinner while it is still loading without one, the globe otherwise.
 * While the agent is working in this tab the favicon gives way to the
 * thinking loader, so the strip shows where the agent is without pulling the
 * user's selection there.
 */
export function BrowserTabIcon({ tabId, scopeId, className }: BrowserTabIconProps) {
  const tab = useBrowserSessionStore((state) =>
    scopeId ? state.sessions[scopeId]?.tabs.find((entry) => entry.tabId === tabId) : undefined
  )
  const agentWorking = useBrowserSessionStore((state) => {
    const session = scopeId ? state.sessions[scopeId] : undefined
    return Boolean(
      session &&
        session.automationTabId === tabId &&
        (session.automationActive || session.agentRunIds.length > 0)
    )
  })
  /** The host whose icon has painted; a failed icon never paints, so the globe stays. */
  const [loadedHost, setLoadedHost] = useState<string | null>(null)

  const hostname = tab ? siteHost(tab.url) : null
  const faviconLoaded = hostname !== null && loadedHost === hostname
  const showSpinner = shouldShowBrowserTabSpinner(tab?.loading ?? false, hostname, loadedHost)

  return (
    <span className={cn('relative flex items-center justify-center', className)}>
      {agentWorking ? (
        <ThinkingLoader size={14} startVariant='corners' />
      ) : tab?.issue ? (
        <CircleAlert className='size-[12px] text-[var(--text-icon)]' />
      ) : (
        <>
          <Favicon
            key={hostname}
            host={hostname}
            fallback={null}
            className={cn(
              'size-[16px] rounded-[3px]',
              !faviconLoaded && 'pointer-events-none absolute opacity-0'
            )}
            onLoad={() => setLoadedHost(hostname)}
          />
          {showSpinner ? (
            <Loader
              animate
              className='size-[14px] text-[var(--text-icon)] [--loader-duration:650ms]'
              strokeWidth={2}
            />
          ) : !faviconLoaded ? (
            <Globe className='size-[12px] text-[var(--text-icon)]' />
          ) : null}
        </>
      )}
    </span>
  )
}
