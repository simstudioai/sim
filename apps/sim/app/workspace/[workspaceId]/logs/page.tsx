import { Suspense } from 'react'
import type { Metadata } from 'next'
import LogsLoading from '@/app/workspace/[workspaceId]/logs/loading'
import Logs from '@/app/workspace/[workspaceId]/logs/logs'

export const metadata: Metadata = {
  title: 'Logs',
}

/**
 * Logs page entry. `Logs` reads URL query params via nuqs (which uses
 * `useSearchParams` internally), so it must sit under a Suspense boundary. The
 * fallback renders the real chrome so a suspend never shows a blank frame; the
 * route-level `loading.tsx` covers the navigation/chunk-load transition.
 */
export default function LogsPage() {
  return (
    <Suspense fallback={<LogsLoading />}>
      <Logs />
    </Suspense>
  )
}
