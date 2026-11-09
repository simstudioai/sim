import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

export const metadata: Metadata = { title: 'Files' }

/** Rendered per request: a build must never prerender a viewer's page. */
export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [{ workspaceId }, { FileBrowser }] = await Promise.all([
    params,
    import('@/app/(product)/workspace/[workspaceId]/files/_components/file-browser/file-browser'),
  ])
  return <FileBrowser workspaceId={workspaceId} />
}
