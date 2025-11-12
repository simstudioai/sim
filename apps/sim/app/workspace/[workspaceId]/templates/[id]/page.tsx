import { db } from '@sim/db'
import { templateCreators, templateStars, templates } from '@sim/db/schema'
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
    if (!id || typeof id !== 'string' || id.length !== 36) {
      notFound()
    }

    const session = await getSession()

    const templateData = await db
      .select({
        template: templates,
        creator: templateCreators,
      })
      .from(templates)
      .leftJoin(templateCreators, eq(templates.creatorId, templateCreators.id))
      .where(eq(templates.id, id))
      .limit(1)

    if (templateData.length === 0) {
      notFound()
    }

    const { template, creator } = templateData[0]

    if (!session?.user?.id && template.status !== 'approved') {
      notFound()
    }

    if (!template.id || !template.name) {
      logger.error('Template missing required fields:', {
        id: template.id,
        name: template.name,
      })
      notFound()
    }

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
        isStarred = false
      }
    }

    const serializedTemplate = {
      ...template,
      creator: creator || null,
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
      isStarred,
    }

    return (
      <TemplateDetails
        template={JSON.parse(JSON.stringify(serializedTemplate))}
        workspaceId={workspaceId}
        currentUserId={session?.user?.id || null}
      />
    )
  } catch (error) {
    logger.error('Error loading template:', error)
    return (
      <div className='flex h-[100vh] items-center justify-center pl-64'>
        <div className='text-center'>
          <h1 className='mb-[14px] font-medium text-[18px]'>Error Loading Template</h1>
          <p className='text-[#888888] text-[14px]'>There was an error loading this template.</p>
          <p className='mt-[10px] text-[#888888] text-[12px]'>Template ID: {id}</p>
          <p className='mt-[10px] text-[12px] text-red-500'>
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      </div>
    )
  }
}
