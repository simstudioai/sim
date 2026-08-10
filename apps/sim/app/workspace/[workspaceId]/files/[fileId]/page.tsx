import { Suspense } from 'react'
import type { Metadata } from 'next'
import { Files } from '@/app/workspace/[workspaceId]/files/files'
import FilesLoading from '@/app/workspace/[workspaceId]/files/loading'

export const metadata: Metadata = {
  title: 'Files',
  robots: { index: false },
}

export default function FilesFilePage() {
  return (
    <Suspense fallback={<FilesLoading />}>
      <Files />
    </Suspense>
  )
}
