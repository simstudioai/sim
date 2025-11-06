import { db } from '@sim/db'
import {
  member,
  templateStars,
  templates,
  user,
  workflow,
  workflowDeploymentVersion,
} from '@sim/db/schema'
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('TemplatesAPI')

export const revalidate = 0

// Function to sanitize sensitive data from workflow state
function sanitizeWorkflowState(state: any): any {
  const sanitizedState = JSON.parse(JSON.stringify(state)) // Deep clone

  if (sanitizedState.blocks) {
    Object.values(sanitizedState.blocks).forEach((block: any) => {
      if (block.subBlocks) {
        Object.entries(block.subBlocks).forEach(([key, subBlock]: [string, any]) => {
          // Clear OAuth credentials and API keys using regex patterns
          if (
            /credential|oauth|api[_-]?key|token|secret|auth|password|bearer/i.test(key) ||
            /credential|oauth|api[_-]?key|token|secret|auth|password|bearer/i.test(
              subBlock.type || ''
            ) ||
            /credential|oauth|api[_-]?key|token|secret|auth|password|bearer/i.test(
              subBlock.value || ''
            )
          ) {
            subBlock.value = ''
          }
        })
      }

      // Also clear from data field if present
      if (block.data) {
        Object.entries(block.data).forEach(([key, value]: [string, any]) => {
          if (/credential|oauth|api[_-]?key|token|secret|auth|password|bearer/i.test(key)) {
            block.data[key] = ''
          }
        })
      }
    })
  }

  return sanitizedState
}

// Schema for creating a template
const CreateTemplateSchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required'),
  name: z.string().min(1, 'Name is required').max(100, 'Name must be less than 100 characters'),
  description: z
    .string()
    .min(1, 'Description is required')
    .max(500, 'Description must be less than 500 characters'),
  author: z
    .string()
    .min(1, 'Author is required')
    .max(100, 'Author must be less than 100 characters'),
  authorType: z.enum(['user', 'organization']).default('user'),
  organizationId: z.string().optional(),
})

// Schema for query parameters
const QueryParamsSchema = z.object({
  limit: z.coerce.number().optional().default(50),
  offset: z.coerce.number().optional().default(0),
  search: z.string().optional(),
  workflowId: z.string().optional(),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  includeAllStatuses: z.coerce.boolean().optional().default(false), // For super users
})

// GET /api/templates - Retrieve templates
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized templates access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const params = QueryParamsSchema.parse(Object.fromEntries(searchParams.entries()))

    logger.debug(`[${requestId}] Fetching templates with params:`, params)

    // Check if user is a super user
    const currentUser = await db.select().from(user).where(eq(user.id, session.user.id)).limit(1)
    const isSuperUser = currentUser[0]?.isSuperUser || false

    // Build query conditions
    const conditions = []

    // Apply workflow filter if provided (for getting template by workflow)
    // When fetching by workflowId, we want to get the template regardless of status
    // This is used by the deploy modal to check if a template exists
    if (params.workflowId) {
      conditions.push(eq(templates.workflowId, params.workflowId))
      // Don't apply status filter when fetching by workflowId - we want to show
      // the template to its owner even if it's pending
    } else {
      // Apply status filter - only approved templates for non-super users
      if (params.status) {
        conditions.push(eq(templates.status, params.status))
      } else if (!isSuperUser || !params.includeAllStatuses) {
        // Non-super users and super users without includeAllStatuses flag see only approved templates
        conditions.push(eq(templates.status, 'approved'))
      }
    }

    // Apply search filter if provided
    if (params.search) {
      const searchTerm = `%${params.search}%`
      conditions.push(
        or(ilike(templates.name, searchTerm), ilike(templates.description, searchTerm))
      )
    }

    // Combine conditions
    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined

    // Apply ordering, limit, and offset with star information
    const results = await db
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
        state: templates.state,
        createdAt: templates.createdAt,
        updatedAt: templates.updatedAt,
        isStarred: sql<boolean>`CASE WHEN ${templateStars.id} IS NOT NULL THEN true ELSE false END`,
        isSuperUser: sql<boolean>`${isSuperUser}`, // Include super user status in response
      })
      .from(templates)
      .leftJoin(
        templateStars,
        and(eq(templateStars.templateId, templates.id), eq(templateStars.userId, session.user.id))
      )
      .where(whereCondition)
      .orderBy(desc(templates.views), desc(templates.createdAt))
      .limit(params.limit)
      .offset(params.offset)

    // Get total count for pagination
    const totalCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(templates)
      .where(whereCondition)

    const total = totalCount[0]?.count || 0

    logger.info(`[${requestId}] Successfully retrieved ${results.length} templates`)

    return NextResponse.json({
      data: results,
      pagination: {
        total,
        limit: params.limit,
        offset: params.offset,
        page: Math.floor(params.offset / params.limit) + 1,
        totalPages: Math.ceil(total / params.limit),
      },
    })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid query parameters`, { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid query parameters', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error fetching templates`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/templates - Create a new template
export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized template creation attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const data = CreateTemplateSchema.parse(body)

    logger.debug(`[${requestId}] Creating template:`, {
      name: data.name,
      workflowId: data.workflowId,
    })

    // Verify the workflow exists and belongs to the user
    const workflowExists = await db
      .select({ id: workflow.id })
      .from(workflow)
      .where(eq(workflow.id, data.workflowId))
      .limit(1)

    if (workflowExists.length === 0) {
      logger.warn(`[${requestId}] Workflow not found: ${data.workflowId}`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Validate organization ownership if authorType is organization
    if (data.authorType === 'organization') {
      if (!data.organizationId) {
        logger.warn(`[${requestId}] Organization ID required for organization author type`)
        return NextResponse.json(
          { error: 'Organization ID is required when author type is organization' },
          { status: 400 }
        )
      }

      // Verify user is a member of the organization
      const membership = await db
        .select()
        .from(member)
        .where(
          and(eq(member.userId, session.user.id), eq(member.organizationId, data.organizationId))
        )
        .limit(1)

      if (membership.length === 0) {
        logger.warn(`[${requestId}] User not a member of organization: ${data.organizationId}`)
        return NextResponse.json(
          { error: 'You must be a member of the organization to publish on its behalf' },
          { status: 403 }
        )
      }
    }

    // Create the template
    const templateId = uuidv4()
    const now = new Date()

    // Get the active deployment version for the workflow to copy its state
    const activeVersion = await db
      .select({
        id: workflowDeploymentVersion.id,
        state: workflowDeploymentVersion.state,
      })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, data.workflowId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .limit(1)

    if (activeVersion.length === 0) {
      logger.warn(
        `[${requestId}] No active deployment version found for workflow: ${data.workflowId}`
      )
      return NextResponse.json(
        { error: 'Workflow must be deployed before creating a template' },
        { status: 400 }
      )
    }

    const newTemplate = {
      id: templateId,
      workflowId: data.workflowId,
      userId: session.user.id,
      name: data.name,
      description: data.description || null,
      author: data.author,
      authorType: data.authorType,
      organizationId: data.organizationId || null,
      views: 0,
      stars: 0,
      status: 'pending' as const, // All new templates start as pending
      state: activeVersion[0].state, // Copy the state from the deployment version
      createdAt: now,
      updatedAt: now,
    }

    await db.insert(templates).values(newTemplate)

    logger.info(`[${requestId}] Successfully created template: ${templateId}`)

    return NextResponse.json(
      {
        id: templateId,
        message: 'Template submitted for approval successfully',
      },
      { status: 201 }
    )
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid template data`, { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid template data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error creating template`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
