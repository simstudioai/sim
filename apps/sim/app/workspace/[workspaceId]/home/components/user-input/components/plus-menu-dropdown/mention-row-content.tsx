'use client'

import type { ReactNode } from 'react'
import { chipContentGap, cn, OverflowText } from '@sim/emcn'
import { FolderPathLabel } from '@/components/ui'
import { getResourceConfig } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type { FolderMentionLocation } from '@/app/workspace/[workspaceId]/home/components/user-input/components/plus-menu-dropdown/resource-mention-items'

export interface MentionRowContentProps {
  /** The resource family's own row rendering, a fragment of the row's flex children. */
  children: ReactNode
  /** Present only for folder rows, which need a location to disambiguate same-named siblings. */
  location?: FolderMentionLocation
  workspaceName?: string
}

/**
 * Body of one flat mention row.
 *
 * Rows without a location render their family output as direct children of the row
 * button, unwrapped. That is load-bearing rather than incidental: renderers such as
 * the log row pin trailing content with `ml-auto`, which only reaches the row's right
 * edge while the button is its flex parent. Wrapping every row would silently pull
 * those timestamps back beside the name.
 */
export function MentionRowContent({ children, location, workspaceName }: MentionRowContentProps) {
  const workspaceLabel = workspaceName ? (
    <OverflowText
      label={workspaceName}
      className={cn(
        'max-w-[35%] shrink-0 text-[var(--text-muted)] text-xs',
        !location && 'ml-auto'
      )}
    />
  ) : null

  if (!location) {
    return (
      <>
        {children}
        {workspaceLabel}
      </>
    )
  }

  return (
    <>
      {/* Capped rather than shrinkable so a long name cannot squeeze out the segment
          that tells two same-named folders apart. */}
      <span
        className={cn(
          'flex min-w-0 flex-shrink-0 items-center',
          chipContentGap,
          workspaceName ? 'max-w-[50%]' : 'max-w-[65%]'
        )}
      >
        {children}
      </span>
      <span className={cn('ml-auto flex min-w-0 flex-1 items-center justify-end', chipContentGap)}>
        <FolderPathLabel
          prefix={getResourceConfig(location.familyType).label}
          segments={location.parentNames}
          className='ml-0 pl-0'
        />
        {workspaceLabel}
      </span>
    </>
  )
}
