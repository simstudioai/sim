import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import { RESOURCE_HEADER_CLASSES } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'

interface HomeFallbackProps {
  header?: ReactNode
}

/**
 * Suspense fallback for the home/Chat surface. `Home` reads the `?resource=`
 * URL param via nuqs (`useQueryState`, which uses `useSearchParams`
 * internally), so it must sit under a Suspense boundary. This renders the
 * surface background so a suspend never flashes a blank frame before the chat
 * mounts.
 */
export function HomeFallback({ header }: HomeFallbackProps) {
  return (
    <div className={cn('h-full bg-[var(--bg)]', header && RESOURCE_HEADER_CLASSES.layout)}>
      {header && <div className={RESOURCE_HEADER_CLASSES.content}>{header}</div>}
    </div>
  )
}
