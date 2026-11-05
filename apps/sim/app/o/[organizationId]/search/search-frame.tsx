'use client'

import { lazy, type ReactNode, Suspense } from 'react'
import { cn } from '@sim/emcn'
import type { OrganizationConversationProps } from '@/app/o/[organizationId]/components/organization-conversation'
import type { OrganizationSearchState } from '@/app/o/[organizationId]/search/use-organization-search'
import { RESOURCE_HEADER_CLASSES } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'

const OrganizationConversation = lazy(() =>
  import('@/app/o/[organizationId]/components/organization-conversation').then((module) => ({
    default: module.OrganizationConversation,
  }))
)

interface SearchFrameProps {
  search: OrganizationSearchState
  /** The view switch and New control, shown over both views. */
  header: ReactNode
  /** The Search view. It renders beside the conversation, never around it. */
  children: ReactNode
  /** How the Assistant view looks: its own chrome, its landing, and what stands in for it loading. */
  assistant: Pick<OrganizationConversationProps, 'appearance' | 'fallback' | 'landing'>
  /** Shown while the viewer's saved view has not resolved. */
  unresolvedFallback: ReactNode
}

/**
 * Hosts the two views of Search. Assistant stays mounted and `inert` while Search shows, so a running
 * answer keeps streaming and its draft survives a switch.
 */
export function SearchFrame({
  search,
  header,
  children,
  assistant,
  unresolvedFallback,
}: SearchFrameProps) {
  const { activeMode } = search
  return (
    <div className='h-full min-h-0 min-w-0 bg-[var(--bg)] pt-[var(--workspace-content-title-bar-inset)]'>
      <div className='flex h-full min-h-0 min-w-0 flex-col [--workspace-content-title-bar-inset:0px]'>
        {search.assistantMounted && (
          <div
            inert={activeMode !== 'assistant'}
            className={cn(
              'min-h-0 min-w-0 flex-1 flex-col',
              activeMode === 'assistant' ? 'flex' : 'hidden'
            )}
          >
            <Suspense fallback={assistant.fallback}>
              <OrganizationConversation
                key={search.conversationInstance}
                {...assistant}
                requestMode='assistant'
                chatId={search.chatId}
                header={header}
                active={activeMode === 'assistant'}
                summaryRequest={search.pendingSummary}
                onSummaryConsumed={search.consumeSummary}
              />
            </Suspense>
          </div>
        )}
        {!activeMode && unresolvedFallback}
        {activeMode === 'search' && (
          <>
            <div className={cn(RESOURCE_HEADER_CLASSES.layout, RESOURCE_HEADER_CLASSES.content)}>
              {header}
            </div>
            <div className='flex min-h-0 min-w-0 flex-1 flex-col'>{children}</div>
          </>
        )}
      </div>
    </div>
  )
}
