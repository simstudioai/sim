'use client'

import { useState } from 'react'
import { isBrowserToolName } from '@sim/browser-protocol'
import { cn } from '@sim/emcn-legacy'
import { Globe } from '@sim/emcn-legacy/icons'
import { isRecordLike, toRecordOrNull } from '@sim/utils/object'
import { Favicon } from '@/components/favicon/favicon'
import { useChatSurface } from '@/components/mothership-chat/chat-surface-context'
import type { AgentGroupItem } from '@/components/mothership-chat/message-content/components/agent-group/agent-group-view'
import { isBrowserAgentAvailable } from '@/lib/browser-agent/transport'
import { siteHost } from '@/lib/favicon/url'
import { ToolCallStatus } from '@/lib/mothership/chat/types'
import { useBrowserSessionStore } from '@/stores/browser-session/store'

/**
 * The host of the page this run last observed, so a historical icon never follows another run's
 * live tab. Only the hostname is kept, never credentials, port, path or query.
 */
export function getBrowserAgentPageHost(items: AgentGroupItem[]): string | null {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (item.type !== 'tool' || !isBrowserToolName(item.data.toolName)) continue
    const { toolName, status, params, result } = item.data
    if (status !== ToolCallStatus.executing && status !== ToolCallStatus.success) continue
    /** Element-scoped reads can report an iframe URL rather than the browser page. */
    if (toolName === 'browser_read_text' && params?.elementId !== undefined) continue

    const navigatesToUrl =
      toolName === 'browser_navigate' ||
      toolName === 'browser_open_url' ||
      toolName === 'browser_open_tab'
    if (status === ToolCallStatus.executing && navigatesToUrl) {
      return typeof params?.url === 'string' ? siteHost(params.url) : null
    }

    const output = result?.success ? toRecordOrNull(result.output) : null
    if (output) {
      if (isRecordLike(output.activeTab) && typeof output.activeTab.url === 'string') {
        return siteHost(output.activeTab.url)
      }
      if (typeof output.url === 'string') return siteHost(output.url)
      if (
        toolName === 'browser_extract' &&
        isRecordLike(output.page) &&
        typeof output.page.url === 'string'
      ) {
        return siteHost(output.page.url)
      }
      if (
        toolName === 'browser_screenshot' &&
        isRecordLike(output.viewport) &&
        typeof output.viewport.url === 'string'
      ) {
        return siteHost(output.viewport.url)
      }
      if (toolName === 'browser_list_tabs' && Array.isArray(output.tabs)) {
        const tabId = 'automationTabId' in output ? output.automationTabId : output.activeTabId
        const tab = output.tabs.find((tab) => isRecordLike(tab) && tab.tabId === tabId)
        return isRecordLike(tab) && typeof tab.url === 'string' ? siteHost(tab.url) : null
      }
      /** A navigation without a destination invalidates the previous page observation. */
      if (
        isRecordLike(output.effect) &&
        (output.effect.urlChanged === true ||
          output.effect.topUrlChanged === true ||
          output.effect.tabChanged === true)
      ) {
        return null
      }
    }
    if (
      navigatesToUrl ||
      toolName === 'browser_switch_tab' ||
      toolName === 'browser_close_tab' ||
      toolName === 'browser_go_back' ||
      toolName === 'browser_go_forward'
    ) {
      return null
    }
  }
  return null
}

interface BrowserAgentIconProps {
  items: AgentGroupItem[]
}

export function BrowserAgentIcon({ items }: BrowserAgentIconProps) {
  const { chatId } = useChatSurface()
  const host = getBrowserAgentPageHost(items)
  const pageIsOpen = useBrowserSessionStore((state) => {
    const session = chatId ? state.sessions[chatId] : undefined
    if (!host || !session?.sessionAlive || session.suspended) return false
    const tab = session.tabs.find((tab) => tab.tabId === session.automationTabId)
    return Boolean(tab && !tab.loading && !tab.issue && siteHost(tab.url) === host)
  })
  return (
    <BrowserAgentFavicon
      key={`${chatId ?? ''}:${host ?? ''}`}
      host={host}
      canLoad={isBrowserAgentAvailable() && pageIsOpen}
    />
  )
}

interface BrowserAgentFaviconProps {
  host: string | null
  canLoad: boolean
}

function BrowserAgentFavicon({ host, canLoad }: BrowserAgentFaviconProps) {
  const [loaded, setLoaded] = useState(false)

  return (
    <span className='relative flex size-full items-center justify-center' aria-hidden='true'>
      {/* History alone never looks up a site's icon; keep an already loaded image after the tab closes. */}
      <Favicon
        host={canLoad || loaded ? host : null}
        fallback={null}
        className={cn(
          'size-full rounded-[3px]',
          !loaded && 'pointer-events-none absolute opacity-0'
        )}
        onLoad={() => setLoaded(true)}
      />
      {!loaded && <Globe className='size-full' />}
    </span>
  )
}
