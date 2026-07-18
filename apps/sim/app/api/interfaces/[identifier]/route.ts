import { db } from '@sim/db'
import { workflow, workflowInterface, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import {
  executePublicInterfaceContract,
  getPublicInterfaceContract,
} from '@/lib/api/contracts/interfaces'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  type InterfaceSpec,
  type OutputConfig,
  toPublicInterfaceDto,
  toPublicSafeError,
  toPublicSafeInputError,
} from '@/lib/interfaces'
import { executePublicInterfaceAction } from '@/lib/interfaces/execute-public-interface'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('PublicInterfaceAPI')

export const maxDuration = 3600

const MAX_BODY_BYTES = 1_048_576

async function resolveActiveWorkspaceId(workflowId: string): Promise<string | null> {
  const [row] = await db
    .select({ workspaceId: workflow.workspaceId })
    .from(workflow)
    .innerJoin(workspace, eq(workspace.id, workflow.workspaceId))
    .where(
      and(eq(workflow.id, workflowId), isNull(workflow.archivedAt), isNull(workspace.archivedAt))
    )
    .limit(1)
  return row?.workspaceId ?? null
}

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ identifier: string }> }) => {
    const parsed = await parseRequest(getPublicInterfaceContract, request, context)
    if (!parsed.success) return parsed.response

    const { identifier } = parsed.data.params
    try {
      const [row] = await db
        .select()
        .from(workflowInterface)
        .where(
          and(
            eq(workflowInterface.identifier, identifier),
            isNull(workflowInterface.archivedAt),
            eq(workflowInterface.isActive, true)
          )
        )
        .limit(1)

      if (!row) {
        return createErrorResponse('This interface is not available', 404)
      }

      if (row.authType !== 'public') {
        return createErrorResponse('This interface is not available', 404)
      }
      if (!(await resolveActiveWorkspaceId(row.workflowId))) {
        return createErrorResponse('This interface is not available', 404)
      }

      const customizations = (row.customizations || {}) as {
        primaryColor?: string
        brief?: string
      }

      const dto = toPublicInterfaceDto(
        {
          title: row.title,
          description: row.description,
          primaryColor: customizations.primaryColor,
        },
        row.spec as InterfaceSpec
      )

      return createSuccessResponse(dto)
    } catch (error) {
      logger.error('Error loading interface:', error)
      return createErrorResponse('This interface is not available', 500)
    }
  }
)

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ identifier: string }> }) => {
    const requestId = generateRequestId()
    const ticket = tryAdmit()
    if (!ticket) {
      return admissionRejectedResponse()
    }

    try {
      const parsed = await parseRequest(executePublicInterfaceContract, request, context, {
        maxBodyBytes: MAX_BODY_BYTES,
        validationErrorResponse: (error) =>
          createErrorResponse(getValidationErrorMessage(error), 400, 'VALIDATION_ERROR'),
      })
      if (!parsed.success) return parsed.response

      const { identifier } = parsed.data.params
      const { actionId, values } = parsed.data.body

      const [row] = await db
        .select()
        .from(workflowInterface)
        .where(
          and(
            eq(workflowInterface.identifier, identifier),
            isNull(workflowInterface.archivedAt),
            eq(workflowInterface.isActive, true)
          )
        )
        .limit(1)

      if (!row || row.authType !== 'public') {
        return createErrorResponse('This interface is not available', 404)
      }

      const spec = row.spec as InterfaceSpec
      if (!spec?.actions?.some((a) => a.id === actionId)) {
        return createErrorResponse(toPublicSafeInputError('Unknown action'), 400)
      }

      const workspaceId = await resolveActiveWorkspaceId(row.workflowId)
      if (!workspaceId) {
        return createErrorResponse('This interface is not available', 404)
      }

      const result = await executePublicInterfaceAction({
        workflowId: row.workflowId,
        userId: row.userId,
        workspaceId,
        spec,
        outputConfigs: (row.outputConfigs as OutputConfig[]) || [],
        actionId,
        values: values || {},
        requestId,
        abortSignal: request.signal,
      })

      if (!result.success) {
        const response = createErrorResponse(result.message, result.status)
        if (result.status === 429) {
          response.headers.set('Retry-After', '60')
        }
        return response
      }

      return createSuccessResponse(result.body)
    } catch (error) {
      logger.error(`[${requestId}] Interface execute error:`, error)
      return createErrorResponse(toPublicSafeError('Something went wrong'), 500)
    } finally {
      ticket.release()
    }
  }
)
