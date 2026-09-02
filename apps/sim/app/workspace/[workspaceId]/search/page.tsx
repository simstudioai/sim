import { Suspense } from 'react'
import type { Metadata } from 'next'
import { IntegrationTabsHeader } from '@/app/workspace/[workspaceId]/components'
import { Search } from '@/app/workspace/[workspaceId]/search/search'

export const metadata: Metadata = {
  title: 'Search',
}

/**
 * Sim Search page entry. `Search` reads URL query params via nuqs (which uses
 * `useSearchParams` internally), so it must sit under a Suspense boundary. The
 * fallback renders the real page chrome (background + tab header) so a suspend
 * never shows a blank frame.
 */
export default async function SearchPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params

  return (
    <Suspense
      fallback={
        <div className='flex h-full flex-col bg-[var(--bg)]'>
          <IntegrationTabsHeader active='search' workspaceId={workspaceId} />
        </div>
      }
    >
      <Search />
    </Suspense>
  )
}
