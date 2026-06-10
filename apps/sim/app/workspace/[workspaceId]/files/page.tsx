import { Suspense } from 'react'
import type { Metadata } from 'next'
import { Files } from './files'
import FilesLoading from './loading'

export const metadata: Metadata = {
  title: 'Files',
  robots: { index: false },
}

/**
 * Files page entry. `Files` reads `useSearchParams`, so it must sit under a
 * Suspense boundary. The fallback renders the real chrome (header + options +
 * table headers) so a suspend never shows a blank frame; the route-level
 * `loading.tsx` covers the navigation/chunk-load transition the same way.
 */
export default function FilesPage() {
  return (
    <Suspense fallback={<FilesLoading />}>
      <Files />
    </Suspense>
  )
}
