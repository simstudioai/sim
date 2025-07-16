import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { templateStars, templates, workflow } from '@/db/schema'

const logger = createLogger('TemplatesAPI')

export const dynamic = 'force-dynamic'
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
  category: z.string().min(1, 'Category is required'),
  icon: z.string().min(1, 'Icon is required'),
  color: z.string().regex(/^#[0-9A-F]{6}$/i, 'Color must be a valid hex color (e.g., #3972F6)'),
  state: z.object({
    blocks: z.record(z.any()),
    edges: z.array(z.any()),
    loops: z.record(z.any()),
    parallels: z.record(z.any()),
  }),
})

// Schema for query parameters
const QueryParamsSchema = z.object({
  category: z.string().optional(),
  limit: z.coerce.number().optional().default(50),
  offset: z.coerce.number().optional().default(0),
  search: z.string().optional(),
})

// GET /api/templates - Retrieve templates
export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized templates access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const params = QueryParamsSchema.parse(Object.fromEntries(searchParams.entries()))

    logger.debug(`[${requestId}] Fetching templates with params:`, params)

    // Build query conditions
    const conditions = []

    // Apply category filter if provided
    if (params.category) {
      conditions.push(eq(templates.category, params.category))
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
        views: templates.views,
        stars: templates.stars,
        color: templates.color,
        icon: templates.icon,
        category: templates.category,
        state: templates.state,
        createdAt: templates.createdAt,
        updatedAt: templates.updatedAt,
        isStarred: sql<boolean>`CASE WHEN ${templateStars.id} IS NOT NULL THEN true ELSE false END`,
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
  const requestId = crypto.randomUUID().slice(0, 8)

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
      category: data.category,
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

    // Create the template
    const templateId = uuidv4()
    const now = new Date()

    // Sanitize the workflow state to remove sensitive credentials
    const sanitizedState = sanitizeWorkflowState(data.state)

    const newTemplate = {
      id: templateId,
      workflowId: data.workflowId,
      userId: session.user.id,
      name: data.name,
      description: data.description || null,
      author: data.author,
      views: 0,
      stars: 0,
      color: data.color,
      icon: data.icon,
      category: data.category,
      state: sanitizedState,
      createdAt: now,
      updatedAt: now,
    }

    await db.insert(templates).values(newTemplate)

    logger.info(`[${requestId}] Successfully created template: ${templateId}`)

    return NextResponse.json(
      {
        id: templateId,
        message: 'Template created successfully',
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
