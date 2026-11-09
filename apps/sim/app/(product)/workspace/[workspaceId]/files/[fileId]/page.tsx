import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { FileView } from '@/app/(product)/_components/workspace/files/file-view/file-view'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import type { ProductPageProps } from '@/platform/lib/route-props'

export const metadata: Metadata = { title: 'File' }

/** Rendered per request: a build must never prerender a viewer's page. */
export const dynamic = 'force-dynamic'

export default async function Page({
  params,
}: ProductPageProps<{ workspaceId: string; fileId: string }>) {
  if (resolvePlatformMode() !== 'live') notFound()
  const { workspaceId, fileId } = await params
  return <FileView key={fileId} workspaceId={workspaceId} fileId={fileId} />
}
