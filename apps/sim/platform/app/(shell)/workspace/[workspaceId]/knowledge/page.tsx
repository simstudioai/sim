import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

export const metadata: Metadata = { title: 'Knowledge bases' }

/** The mode is per-request; a build with no API origin must not freeze the answer. */
export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [{ workspaceId }, { KnowledgeList }] = await Promise.all([
    params,
    import(
      '@/platform/app/(shell)/workspace/[workspaceId]/knowledge/_components/knowledge-list/knowledge-list'
    ),
  ])
  return <KnowledgeList workspaceId={workspaceId} />
}
