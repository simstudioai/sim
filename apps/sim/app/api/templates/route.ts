import { db } from '@sim/db'
import {
  member,
  templateCreators,
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
import {
  extractRequiredCredentials,
  sanitizeCredentials,
} from '@/lib/workflows/credential-extractor'

const logger = createLogger('TemplatesAPI')

export const revalidate = 0

// Function to sanitize sensitive data from workflow state
// Now uses the more comprehensive sanitizeCredentials from credential-extractor
function sanitizeWorkflowState(state: any): any {
  return sanitizeCredentials(state)
}

// Schema for creating a template
const CreateTemplateSchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required'),
  name: z.string().min(1, 'Name is required').max(100, 'Name must be less than 100 characters'),
  details: z
    .object({
      tagline: z.string().max(500, 'Tagline must be less than 500 characters').optional(),
      about: z.string().optional(), // Markdown long description
    })
    .optional(),
  creatorId: z.string().optional(), // Creator profile ID
  tags: z.array(z.string()).max(10, 'Maximum 10 tags allowed').optional().default([]),
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
        or(
          ilike(templates.name, searchTerm),
          sql`${templates.details}->>'tagline' ILIKE ${searchTerm}`
        )
      )
    }

    // Combine conditions
    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined

    // Apply ordering, limit, and offset with star information
    const results = await db
      .select({
        id: templates.id,
        workflowId: templates.workflowId,
        name: templates.name,
        details: templates.details,
        creatorId: templates.creatorId,
        creator: templateCreators,
        views: templates.views,
        stars: templates.stars,
        status: templates.status,
        tags: templates.tags,
        requiredCredentials: templates.requiredCredentials,
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
      .leftJoin(templateCreators, eq(templates.creatorId, templateCreators.id))
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

    // Validate creator profile if provided
    if (data.creatorId) {
      // Verify the creator profile exists and user has access
      const creatorProfile = await db
        .select()
        .from(templateCreators)
        .where(eq(templateCreators.id, data.creatorId))
        .limit(1)

      if (creatorProfile.length === 0) {
        logger.warn(`[${requestId}] Creator profile not found: ${data.creatorId}`)
        return NextResponse.json({ error: 'Creator profile not found' }, { status: 404 })
      }

      const creator = creatorProfile[0]

      // Verify user has permission to use this creator profile
      if (creator.referenceType === 'user') {
        if (creator.referenceId !== session.user.id) {
          logger.warn(`[${requestId}] User cannot use creator profile: ${data.creatorId}`)
          return NextResponse.json(
            { error: 'You do not have permission to use this creator profile' },
            { status: 403 }
          )
        }
      } else if (creator.referenceType === 'organization') {
        // Verify user is a member of the organization
        const membership = await db
          .select()
          .from(member)
          .where(
            and(eq(member.userId, session.user.id), eq(member.organizationId, creator.referenceId))
          )
          .limit(1)

        if (membership.length === 0) {
          logger.warn(
            `[${requestId}] User not a member of organization for creator: ${data.creatorId}`
          )
          return NextResponse.json(
            { error: 'You must be a member of the organization to use its creator profile' },
            { status: 403 }
          )
        }
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

    // Ensure the state includes workflow variables (if not already included)
    let stateWithVariables = activeVersion[0].state as any
    if (stateWithVariables && !stateWithVariables.variables) {
      // Fetch workflow variables if not in deployment version
      const [workflowRecord] = await db
        .select({ variables: workflow.variables })
        .from(workflow)
        .where(eq(workflow.id, data.workflowId))
        .limit(1)

      stateWithVariables = {
        ...stateWithVariables,
        variables: workflowRecord?.variables || undefined,
      }
    }

    // Extract credential requirements before sanitizing
    const requiredCredentials = extractRequiredCredentials(stateWithVariables)

    // Sanitize the workflow state to remove all credential values
    const sanitizedState = sanitizeWorkflowState(stateWithVariables)

    const newTemplate = {
      id: templateId,
      workflowId: data.workflowId,
      name: data.name,
      details: data.details || null,
      creatorId: data.creatorId || null,
      views: 0,
      stars: 0,
      status: 'pending' as const, // All new templates start as pending
      tags: data.tags || [],
      requiredCredentials: requiredCredentials, // Store the extracted credential requirements
      state: sanitizedState, // Store the sanitized state without credential values
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
