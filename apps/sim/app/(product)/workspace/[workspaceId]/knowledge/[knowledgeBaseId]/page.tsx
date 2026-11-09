import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { KnowledgeBase } from '@/app/(product)/workspace/[workspaceId]/knowledge/[knowledgeBaseId]/_components/knowledge-base/knowledge-base'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

export const metadata: Metadata = { title: 'Knowledge base' }

/** The mode is per-request; a build with no API origin must not freeze the answer. */
export const dynamic = 'force-dynamic'

export default async function Page({
  params,
}: PageProps<'/workspace/[workspaceId]/knowledge/[knowledgeBaseId]'>) {
  if (resolvePlatformMode() !== 'live') notFound()
  const { workspaceId, knowledgeBaseId } = await params
  return <KnowledgeBase workspaceId={workspaceId} knowledgeBaseId={knowledgeBaseId} />
}
