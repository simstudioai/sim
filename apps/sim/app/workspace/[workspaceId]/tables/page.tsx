import { Suspense } from 'react'
import type { Metadata } from 'next'
import TablesLoading from '@/app/workspace/[workspaceId]/tables/loading'
import { Tables } from './tables'

export const metadata: Metadata = {
  title: 'Tables',
}

/**
 * Tables page entry. `Tables` reads URL query params via nuqs (which uses
 * `useSearchParams` internally), so it must sit under a Suspense boundary. The
 * fallback renders the real chrome so a suspend never shows a blank frame; the
 * route-level `loading.tsx` covers the navigation/chunk-load transition.
 */
export default function TablesPage() {
  return (
    <Suspense fallback={<TablesLoading />}>
      <Tables />
    </Suspense>
  )
}
