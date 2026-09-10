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
  /** Outcome of the favicon request for one hostname; the image remounts per host. */
  const [favicon, setFavicon] = useState<{ hostname: string; status: 'loaded' | 'failed' } | null>(
    null
  )

  const hostname = tab ? browserTabHostname(tab.url) : null
  const faviconStatus = hostname && favicon?.hostname === hostname ? favicon.status : null
  const faviconLoaded = faviconStatus === 'loaded'
  const faviconFailed = faviconStatus === 'failed'
  const showSpinner = shouldShowBrowserTabSpinner(
    tab?.loading ?? false,
    hostname,
    faviconLoaded ? hostname : null
  )

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
              onLoad={() => setFavicon({ hostname, status: 'loaded' })}
              onError={() => setFavicon({ hostname, status: 'failed' })}
            />
          )}
          {showSpinner ? (
            <Loader
              animate
              className='size-[14px] text-[var(--text-icon)] [--loader-duration:650ms]'
              strokeWidth={2}
            />
          ) : !faviconLoaded || faviconFailed ? (
            <Globe className='size-[12px] text-[var(--text-icon)]' />
          ) : null}
        </>
      )}
    </span>
  )
}
