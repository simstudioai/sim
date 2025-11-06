import { db } from '@sim/db'
import { templateStars, templates, workflowDeploymentVersion } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import TemplateDetails from '@/app/workspace/[workspaceId]/templates/[id]/template'

const logger = createLogger('TemplatePage')

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

    // Fetch template data - no auth required for viewing
    const templateData = await db
      .select({
        id: templates.id,
        workflowId: templates.workflowId,
        userId: templates.userId,
        name: templates.name,
        description: templates.description,
        author: templates.author,
        authorType: templates.authorType,
        organizationId: templates.organizationId,
        views: templates.views,
        stars: templates.stars,
        status: templates.status,
        deploymentVersionId: templates.deploymentVersionId,
        state: workflowDeploymentVersion.state,
        createdAt: templates.createdAt,
        updatedAt: templates.updatedAt,
      })
      .from(templates)
      .leftJoin(
        workflowDeploymentVersion,
        eq(templates.deploymentVersionId, workflowDeploymentVersion.id)
      )
      .where(eq(templates.id, id))
      .limit(1)

    if (templateData.length === 0) {
      notFound()
    }

    const template = templateData[0]

    // Only show approved templates to non-logged-in users
    if (!session?.user?.id && template.status !== 'approved') {
      notFound()
    }

    // Validate that required fields are present
    if (!template.id || !template.name || !template.author) {
      logger.error('Template missing required fields:', {
        id: template.id,
        name: template.name,
        author: template.author,
      })
      notFound()
    }

    // Check if user has starred this template (only if logged in)
    let isStarred = false
    if (session?.user?.id) {
      try {
        const starData = await db
          .select({ id: templateStars.id })
          .from(templateStars)
          .where(
            and(
              eq(templateStars.templateId, template.id),
              eq(templateStars.userId, session.user.id)
            )
          )
          .limit(1)
        isStarred = starData.length > 0
      } catch {
        // Continue with isStarred = false
      }
    }

    // Ensure proper serialization of the template data with null checks
    // Parse state if it's a string
    let parsedState = template.state
    if (typeof parsedState === 'string') {
      try {
        parsedState = JSON.parse(parsedState)
      } catch (e) {
        logger.error('Failed to parse template state', e)
      }
    }

    const serializedTemplate = {
      id: template.id,
      workflowId: template.workflowId,
      userId: template.userId,
      name: template.name,
      description: template.description,
      author: template.author,
      authorType: template.authorType,
      organizationId: template.organizationId,
      views: template.views,
      stars: template.stars,
      status: template.status,
      deploymentVersionId: template.deploymentVersionId,
      state: parsedState,
      createdAt: template.createdAt ? template.createdAt.toISOString() : new Date().toISOString(),
      updatedAt: template.updatedAt ? template.updatedAt.toISOString() : new Date().toISOString(),
      isStarred,
    }

    // Deep serialize to ensure Next.js can pass it to client component
    const fullySerializedTemplate = JSON.parse(JSON.stringify(serializedTemplate))

    logger.info('Rendering template detail page', {
      templateId: fullySerializedTemplate.id,
      templateName: fullySerializedTemplate.name,
      hasState: !!fullySerializedTemplate.state,
      stateType: typeof fullySerializedTemplate.state,
    })

    return (
      <TemplateDetails
        template={fullySerializedTemplate}
        workspaceId={workspaceId}
        currentUserId={session?.user?.id || null}
      />
    )
  } catch (error) {
    logger.error('Error loading template:', error)
    return (
      <div className='flex h-screen items-center justify-center'>
        <div className='text-center'>
          <h1 className='mb-4 font-bold text-2xl'>Error Loading Template</h1>
          <p className='text-muted-foreground'>There was an error loading this template.</p>
          <p className='mt-2 text-muted-foreground text-sm'>Template ID: {id}</p>
          <p className='mt-2 text-red-500 text-xs'>
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      </div>
    )
  }
}
