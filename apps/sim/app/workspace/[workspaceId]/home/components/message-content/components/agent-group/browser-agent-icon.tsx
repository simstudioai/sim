'use client'

import { useState } from 'react'
import { isBrowserToolName } from '@sim/browser-protocol'
import { cn } from '@sim/emcn'
import { Globe } from '@sim/emcn/icons'
import { isRecordLike } from '@sim/utils/object'
import type { AgentGroupItem } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-view'
import { ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

function pageFaviconUrl(url: string): string | null {
  try {
    const page = new URL(url)
    /** External images must use HTTPS under the app's content security policy. */
    if (page.protocol !== 'https:') return null
    return `${page.origin}/favicon.ico`
  } catch {
    return null
  }
}

/** Uses this run's page observations so historical icons never follow another run's live tab. */
export function getBrowserAgentFaviconUrl(items: AgentGroupItem[]): string | null {
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
      return typeof params?.url === 'string' ? pageFaviconUrl(params.url) : null
    }

    const output = result?.success && isRecordLike(result.output) ? result.output : null
    if (output) {
      if (isRecordLike(output.activeTab) && typeof output.activeTab.url === 'string') {
        return pageFaviconUrl(output.activeTab.url)
      }
      if (typeof output.url === 'string') return pageFaviconUrl(output.url)
      if (
        toolName === 'browser_extract' &&
        isRecordLike(output.page) &&
        typeof output.page.url === 'string'
      ) {
        return pageFaviconUrl(output.page.url)
      }
      if (
        toolName === 'browser_screenshot' &&
        isRecordLike(output.viewport) &&
        typeof output.viewport.url === 'string'
      ) {
        return pageFaviconUrl(output.viewport.url)
      }
      if (toolName === 'browser_list_tabs' && Array.isArray(output.tabs)) {
        const tabId = 'automationTabId' in output ? output.automationTabId : output.activeTabId
        const tab = output.tabs.find((tab) => isRecordLike(tab) && tab.tabId === tabId)
        return isRecordLike(tab) && typeof tab.url === 'string' ? pageFaviconUrl(tab.url) : null
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
  const url = getBrowserAgentFaviconUrl(items)
  return <BrowserAgentFavicon key={url} url={url} />
}

interface BrowserAgentFaviconProps {
  url: string | null
}

function BrowserAgentFavicon({ url }: BrowserAgentFaviconProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading')

  return (
    <span className='relative flex size-[16px] items-center justify-center' aria-hidden='true'>
      {url && status !== 'failed' && (
        <img
          src={url}
          referrerPolicy='no-referrer'
          alt=''
          className={cn(
            'size-[16px] rounded-[3px]',
            status !== 'loaded' && 'pointer-events-none absolute opacity-0'
          )}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('failed')}
        />
      )}
      {(!url || status !== 'loaded') && <Globe className='size-[16px] text-[var(--text-icon)]' />}
    </span>
  )
}
