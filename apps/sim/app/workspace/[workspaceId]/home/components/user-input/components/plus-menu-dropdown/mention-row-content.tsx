'use client'

import type { ReactNode } from 'react'
import { FolderPathLabel } from '@/components/ui'
import { getResourceConfig } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type { FolderMentionLocation } from '@/app/workspace/[workspaceId]/home/components/user-input/components/plus-menu-dropdown/resource-mention-items'

export interface MentionRowContentProps {
  /** The resource family's own row rendering, a fragment of the row's flex children. */
  children: ReactNode
  /** Present only for folder rows, which need a location to disambiguate same-named siblings. */
  location?: FolderMentionLocation
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
export function MentionRowContent({ children, location }: MentionRowContentProps) {
  if (!location) return <>{children}</>

  return (
    <>
      {/* Capped rather than shrinkable so a long name cannot squeeze out the segment
          that tells two same-named folders apart. */}
      <span className='flex max-w-[65%] flex-shrink-0 items-center gap-2 [&>span]:min-w-0 [&>span]:truncate'>
        {children}
      </span>
      <FolderPathLabel
        prefix={getResourceConfig(location.familyType).label}
        segments={location.parentNames}
      />
    </>
  )
}
