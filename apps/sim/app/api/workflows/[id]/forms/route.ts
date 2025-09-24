import { db } from '@sim/db'
import { workflow, workflowForm } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { getSession } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * Create or update a workflow form configuration
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const workflowId = (await params).id
    const body = await request.json()

    const { blockId, title, description, formConfig, settings, styling } = body

    const workflowResult = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (workflowResult.length === 0) {
      return new NextResponse('Workflow not found', { status: 404 })
    }

    const workflowData = workflowResult[0]
    if (workflowData.userId !== session.user.id) {
      return new NextResponse('Access denied', { status: 403 })
    }

    const existingForm = await db
      .select()
      .from(workflowForm)
      .where(and(eq(workflowForm.workflowId, workflowId), eq(workflowForm.blockId, blockId)))
      .limit(1)

    const formPath = uuidv4()
    const formData = {
      workflowId,
      blockId,
      path: formPath,
      title,
      description,
      formConfig,
      styling: styling || {},
      settings: settings || {},
      isActive: true,
    }

    let result
    if (existingForm.length > 0) {
      result = await db
        .update(workflowForm)
        .set({
          ...formData,
          path: existingForm[0].path,
          updatedAt: new Date(),
        })
        .where(eq(workflowForm.id, existingForm[0].id))
        .returning()

      result[0] = { ...result[0], path: existingForm[0].path }
    } else {
      result = await db
        .insert(workflowForm)
        .values({
          id: uuidv4(),
          ...formData,
        })
        .returning()
    }

    return NextResponse.json({
      id: result[0].id,
      path: result[0].path,
      title: result[0].title,
      formConfig: result[0].formConfig,
    })
  } catch (error: any) {
    console.error('Error creating/updating form:', error)
    return new NextResponse(`Internal Server Error: ${error.message}`, {
      status: 500,
    })
  }
}

/**
 * Get all forms for a workflow
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const workflowId = (await params).id
    const url = new URL(request.url)
    const blockId = url.searchParams.get('blockId')

    const workflowResult = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (workflowResult.length === 0) {
      return new NextResponse('Workflow not found', { status: 404 })
    }

    const workflowData = workflowResult[0]
    if (workflowData.userId !== session.user.id) {
      return new NextResponse('Access denied', { status: 403 })
    }

    const baseCondition = eq(workflowForm.workflowId, workflowId)
    const whereConditions = blockId
      ? and(baseCondition, eq(workflowForm.blockId, blockId))!
      : baseCondition

    const forms = await db.select().from(workflowForm).where(whereConditions)

    return NextResponse.json({ forms })
  } catch (error: any) {
    console.error('Error fetching forms:', error)
    return new NextResponse(`Internal Server Error: ${error.message}`, {
      status: 500,
    })
  }
}

/**
 * Update an existing form configuration
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const workflowId = (await params).id
    const body = await request.json()

    const { blockId, title, description, formConfig, settings, styling } = body

    const workflowResult = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (workflowResult.length === 0) {
      return new NextResponse('Workflow not found', { status: 404 })
    }

    const workflowData = workflowResult[0]
    if (workflowData.userId !== session.user.id) {
      return new NextResponse('Access denied', { status: 403 })
    }

    const existingForm = await db
      .select()
      .from(workflowForm)
      .where(and(eq(workflowForm.workflowId, workflowId), eq(workflowForm.blockId, blockId)))
      .limit(1)

    if (existingForm.length === 0) {
      return new NextResponse('Form not found', { status: 404 })
    }

    const result = await db
      .update(workflowForm)
      .set({
        title,
        description,
        formConfig,
        styling: styling || {},
        settings: settings || {},
        updatedAt: new Date(),
      })
      .where(eq(workflowForm.id, existingForm[0].id))
      .returning()

    return NextResponse.json({
      id: result[0].id,
      path: result[0].path,
      title: result[0].title,
      formConfig: result[0].formConfig,
    })
  } catch (error: any) {
    console.error('Error updating form:', error)
    return new NextResponse(`Internal Server Error: ${error.message}`, {
      status: 500,
    })
  }
}
