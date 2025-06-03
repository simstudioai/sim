import { Metadata } from 'next'
import { TemplateDetailPage } from '../components/template/template'

interface TemplatePageProps {
  params: Promise<{
    id: string
  }>
}

/**
 * Template detail page - simple wrapper that extracts the ID and passes it to the detail component
 * All data fetching, error handling, and loading states are handled by TemplateDetailPage
 */
export default async function TemplatePage({ params }: TemplatePageProps) {
  const { id: templateId } = await params
  
  return <TemplateDetailPage templateId={templateId} />
}

/**
 * Basic metadata for the template page
 * Detailed metadata will be handled by the component once data is loaded
 */
export async function generateMetadata({ params }: TemplatePageProps): Promise<Metadata> {
  
  return {
    title: 'Template | Sim Studio',
    description: 'View workflow template details and preview',
    openGraph: {
      title: 'Template | Sim Studio',
      description: 'View workflow template details and preview',
      type: 'website',
    },
  }
} 