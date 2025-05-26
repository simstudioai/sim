import { KnowledgeBase } from './base'

interface PageProps {
  params: Promise<{
    id: string
  }>
}

export default async function KnowledgeBasePage({ params }: PageProps) {
  const { id } = await params
  return <KnowledgeBase id={id} />
}
