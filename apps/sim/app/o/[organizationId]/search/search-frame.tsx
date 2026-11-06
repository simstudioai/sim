'use client'

import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import type { OrganizationSearchState } from '@/app/o/[organizationId]/search/use-organization-search'
import { RESOURCE_HEADER_CLASSES } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'

interface SearchFrameProps {
  search: OrganizationSearchState
  /** The view switch and New control, shown over both views. */
  header: ReactNode
  /** The Search view. It renders beside the conversation, never around it. */
  children: ReactNode
  /** The Assistant view, mounted beside the Search view once it has been opened. */
  assistant: ReactNode
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
            {assistant}
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
