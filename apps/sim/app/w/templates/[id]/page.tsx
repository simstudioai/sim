import { eq } from 'drizzle-orm'
import type { Metadata } from 'next'
import { db } from '@/db'
import { templates } from '@/db/schema'
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
 * Enhanced metadata generation for rich social sharing
 */
export async function generateMetadata({ params }: TemplatePageProps): Promise<Metadata> {
  try {
    const { id: templateId } = await params

    // Fetch template data for metadata
    const template = await db
      .select({
        id: templates.id,
        name: templates.name,
        short_description: templates.short_description,
        long_description: templates.long_description,
        authorName: templates.authorName,
        category: templates.category,
        views: templates.views,
      })
      .from(templates)
      .where(eq(templates.id, templateId))
      .limit(1)
      .then((rows) => rows[0])

    if (!template) {
      return {
        title: 'Template Not Found | Sim Studio',
        description: 'The requested template could not be found.',
      }
    }

    const title = `${template.name} Template | Sim Studio`
    const description =
      template.short_description ||
      template.long_description ||
      `A ${template.category} template by ${template.authorName} on Sim Studio.`

    // Create the social preview message - this appears when shared in messages/social media
    const socialDescription = `Check this template out on Sim Studio! ${description}`

    // Dynamic OG image URL with template ID
    const ogImageUrl = `https://simstudio.ai/api/og/template?id=${templateId}`

    return {
      title,
      description: socialDescription,
      openGraph: {
        title,
        description: socialDescription,
        type: 'website',
        url: `https://simstudio.ai/w/templates/${templateId}`,
        siteName: 'Sim Studio',
        images: [
          {
            url: ogImageUrl,
            width: 1200,
            height: 630,
            alt: `${template.name} Template on Sim Studio`,
          },
        ],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description: socialDescription,
        images: [ogImageUrl],
        site: '@simstudioai',
        creator: '@simstudioai',
      },
      other: {
        'og:image:width': '1200',
        'og:image:height': '630',
        'theme-color': '#3972F6',
      },
    }
  } catch (error) {
    console.error('Error generating metadata:', error)
    return {
      title: 'Template | Sim Studio',
      description: 'Check this template out on Sim Studio!',
      openGraph: {
        title: 'Template | Sim Studio',
        description: 'Check this template out on Sim Studio!',
        type: 'website',
        siteName: 'Sim Studio',
        images: [
          {
            url: 'https://simstudio.ai/api/og/template',
            width: 1200,
            height: 630,
            alt: 'Template on Sim Studio',
          },
        ],
      },
      twitter: {
        card: 'summary_large_image',
        title: 'Template | Sim Studio',
        description: 'Check this template out on Sim Studio!',
        images: ['https://simstudio.ai/api/og/template'],
        site: '@simstudioai',
        creator: '@simstudioai',
      },
    }
  }
}
