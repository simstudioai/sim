import { notFound } from 'next/navigation'
import { TemplateDetailPage } from './components/template'

interface TemplatePageProps {
  params: {
    templateId: string
  }
}

export default function TemplatePage({ params }: TemplatePageProps) {
  const { templateId } = params

  if (!templateId) {
    notFound()
  }

  return <TemplateDetailPage templateId={templateId} />
}

export async function generateMetadata({ params }: TemplatePageProps) {
  try {
    // Fetch template data for metadata
    const response = await fetch(
      `/api/templates/${params.templateId}/info?includeState=true`,
      { cache: 'force-cache' }
    )
    
    if (!response.ok) {
      return {
        title: 'Template Not Found | Sim Studio',
        description: 'The requested template could not be found.',
      }
    }

    const template = await response.json()
    
    return {
      title: `${template.name} | Templates | Sim Studio`,
      description: template.short_description || `Template by ${template.authorName}`,
      openGraph: {
        title: template.name,
        description: template.short_description,
        type: 'website',
      },
    }
  } catch (error) {
    return {
      title: 'Template | Sim Studio',
      description: 'Discover and use workflow templates',
    }
  }
} 