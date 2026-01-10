import { db } from '@sim/db'
import { form } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('FormStatusAPI')

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()

    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }

    const { id: workflowId } = await params

    const formResult = await db
      .select({
        id: form.id,
        identifier: form.identifier,
        title: form.title,
        isActive: form.isActive,
      })
      .from(form)
      .where(and(eq(form.workflowId, workflowId), eq(form.isActive, true)))
      .limit(1)

    if (formResult.length === 0) {
      return createSuccessResponse({
        isDeployed: false,
        form: null,
      })
    }

    return createSuccessResponse({
      isDeployed: true,
      form: formResult[0],
    })
  } catch (error: any) {
    logger.error('Error fetching form status:', error)
    return createErrorResponse(error.message || 'Failed to fetch form status', 500)
  }
}
