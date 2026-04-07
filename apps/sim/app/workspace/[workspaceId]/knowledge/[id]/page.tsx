import type { Metadata } from 'next'
import { KnowledgeBase } from '@/app/workspace/[workspaceId]/knowledge/[id]/base'

interface PageProps {
  params: Promise<{
    id: string
  }>
  searchParams: Promise<{
    kbName?: string
  }>
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { kbName } = await searchParams
  return { title: kbName || 'Knowledge Base' }
}

export default async function KnowledgeBasePage({ params, searchParams }: PageProps) {
  const { id } = await params
  const { kbName } = await searchParams

  return <KnowledgeBase id={id} knowledgeBaseName={kbName || 'Knowledge Base'} />
}
