import { Suspense } from 'react'
import type { Metadata } from 'next'
import { Interface } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/interface'
import InterfaceLoading from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/loading'

export const metadata: Metadata = {
  title: 'Interface',
}

interface InterfacePageProps {
  params: Promise<{ workspaceId: string; interfaceId: string }>
}

/**
 * Interface-detail page entry. `Interface` reads the `mode` / `module` URL
 * query params via nuqs (which uses `useSearchParams` internally), so it must
 * sit under a Suspense boundary. The fallback renders the real chrome so a
 * suspend never shows a blank frame.
 *
 * The ids are resolved here rather than through `useParams` so the editor takes
 * its address as data — the same way the mothership panel hands it one.
 */
export default async function InterfacePage({ params }: InterfacePageProps) {
  const { workspaceId, interfaceId } = await params

  return (
    <Suspense fallback={<InterfaceLoading />}>
      <Interface workspaceId={workspaceId} interfaceId={interfaceId} host='page' />
    </Suspense>
  )
}
