import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/db'
import { workflow } from '@/db/schema'
import { validateWorkflowAccess } from '../../middleware'
import { createErrorResponse, createSuccessResponse } from '../../utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    const validation = await validateWorkflowAccess(request, id, false)

    if (validation.error) {
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    // Generate a new API key
    const apiKey = `wf_${uuidv4().replace(/-/g, '')}`
    const deployedAt = new Date()

    // Update the workflow with the API key and deployment status
    await db
      .update(workflow)
      .set({
        apiKey,
        isDeployed: true,
        deployedAt,
      })
      .where(eq(workflow.id, id))

    return createSuccessResponse({ apiKey, isDeployed: true, deployedAt })
  } catch (error: any) {
    console.error('Error deploying workflow:', error)
    return createErrorResponse(error.message || 'Failed to deploy workflow', 500)
  }
}
