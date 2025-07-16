import { and, eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { templateStars, templates } from '@/db/schema'
import type { Template } from '../templates'
import TemplateDetails from './template'

interface TemplatePageProps {
  params: Promise<{
    workspaceId: string
    id: string
  }>
}

export default async function TemplatePage({ params }: TemplatePageProps) {
  const { workspaceId, id } = await params

  try {
    // Validate the template ID format (basic UUID validation)
    if (!id || typeof id !== 'string' || id.length !== 36) {
      notFound()
    }

    const session = await getSession()

    if (!session?.user?.id) {
      return <div>Please log in to view this template</div>
    }

    // Fetch template data first without star status to avoid query issues
    const templateData = await db
      .select({
        id: templates.id,
        workflowId: templates.workflowId,
        userId: templates.userId,
        name: templates.name,
        description: templates.description,
        author: templates.author,
        views: templates.views,
        stars: templates.stars,
        color: templates.color,
        icon: templates.icon,
        category: templates.category,
        state: templates.state,
        createdAt: templates.createdAt,
        updatedAt: templates.updatedAt,
      })
      .from(templates)
      .where(eq(templates.id, id))
      .limit(1)

    if (templateData.length === 0) {
      notFound()
    }

    const template = templateData[0]

    // Validate that required fields are present
    if (!template.id || !template.name || !template.author) {
      console.error('Template missing required fields:', {
        id: template.id,
        name: template.name,
        author: template.author,
      })
      notFound()
    }

    // Check if user has starred this template
    let isStarred = false
    try {
      const starData = await db
        .select({ id: templateStars.id })
        .from(templateStars)
        .where(
          and(eq(templateStars.templateId, template.id), eq(templateStars.userId, session.user.id))
        )
        .limit(1)
      isStarred = starData.length > 0
    } catch {
      // Continue with isStarred = false
    }

    // Ensure proper serialization of the template data with null checks
    const serializedTemplate: Template = {
      id: template.id,
      workflowId: template.workflowId,
      userId: template.userId,
      name: template.name,
      description: template.description,
      author: template.author,
      views: template.views,
      stars: template.stars,
      color: template.color || '#3972F6', // Default color if missing
      icon: template.icon || 'FileText', // Default icon if missing
      category: template.category as any,
      state: template.state as any,
      createdAt: template.createdAt ? template.createdAt.toISOString() : new Date().toISOString(),
      updatedAt: template.updatedAt ? template.updatedAt.toISOString() : new Date().toISOString(),
      isStarred,
    }

    console.log('Template from DB:', template)
    console.log('Serialized template:', serializedTemplate)
    console.log('Template state from DB:', template.state)

    return (
      <TemplateDetails
        template={serializedTemplate}
        workspaceId={workspaceId}
        currentUserId={session.user.id}
      />
    )
  } catch (error) {
    console.error('Error loading template:', error)
    return (
      <div className='flex h-screen items-center justify-center'>
        <div className='text-center'>
          <h1 className='mb-4 font-bold text-2xl'>Error Loading Template</h1>
          <p className='text-muted-foreground'>There was an error loading this template.</p>
          <p className='mt-2 text-muted-foreground text-sm'>Template ID: {id}</p>
        </div>
      </div>
    )
  }
}
