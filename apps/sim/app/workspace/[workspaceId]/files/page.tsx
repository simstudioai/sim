import { Suspense } from 'react'
import type { Metadata } from 'next'
import { Files } from './files'

export const metadata: Metadata = {
  title: 'Files',
  robots: { index: false },
}

export default function FilesPage() {
  return (
    <Suspense fallback={null}>
      <Files />
    </Suspense>
  )
}
