import { KnowledgeBase } from './base'

interface PageProps {
  params: Promise<{
    id: string
  }>
  searchParams: Promise<{
    kbName?: string
  }>
}

export default async function KnowledgeBasePage({ params, searchParams }: PageProps) {
  const { id } = await params
  const { kbName } = await searchParams

  return <KnowledgeBase id={id} knowledgeBaseName={kbName || 'Knowledge Base'} />
}
