import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type {
  WindchillOperationBody,
  WindchillOperationResponse,
} from '@/lib/api/contracts/tools/windchill'
import { windchillOperationBodySchema } from '@/lib/api/contracts/tools/windchill'
import { getValidationErrorMessage } from '@/lib/api/server'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { InvalidInternalDelegationBindingError } from '@/lib/auth/internal-delegation'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { createExecutorPrincipalFromExecutionContext } from '@/lib/internal/principals/executor'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { WindchillProviderError } from '@/lib/internal/windchill/client'
import { WindchillOperationError } from '@/lib/internal/windchill/errors'
import { executeWindchillOperation } from '@/lib/internal/windchill/operations'
import { sanitizeWindchillError } from '@/tools/windchill/utils'

const logger = createLogger('WindchillInternalOperation')
const WINDCHILL_DELEGATION_AUDIENCE = 'sim:windchill'

const WINDCHILL_INTERNAL_TOOL_IDS = new Set([
  'windchill_create_document',
  'windchill_create_documents',
  'windchill_update_document',
  'windchill_update_common_properties',
  'windchill_update_documents',
  'windchill_delete_document',
  'windchill_delete_documents',
  'windchill_check_out_document',
  'windchill_check_out_documents',
  'windchill_check_in_document',
  'windchill_check_in_documents',
  'windchill_undo_check_out_document',
  'windchill_undo_check_out_documents',
  'windchill_revise_document',
  'windchill_revise_documents',
  'windchill_set_lifecycle_state',
  'windchill_update_document_security_labels',
  'windchill_download_primary_content',
  'windchill_upload_primary_content',
  'windchill_download_attachment',
  'windchill_upload_attachments',
])

function failureResponse(error: string, status: number): Response {
  const body = {
    success: false,
    error: sanitizeWindchillError(error),
  } satisfies WindchillOperationResponse
  return Response.json(body, { status })
}

function parseInput(input: unknown): WindchillOperationBody | Response {
  if (Buffer.byteLength(JSON.stringify(input) ?? '') > DEFAULT_MAX_JSON_BODY_BYTES) {
    return failureResponse('Windchill request body is too large', 413)
  }

  const parsed = windchillOperationBodySchema.safeParse(input)
  if (!parsed.success) {
    return failureResponse(
      getValidationErrorMessage(parsed.error, 'Invalid Windchill request'),
      400
    )
  }
  return parsed.data
}

export const executeWindchillTool: InternalToolOperationHandler = async (request) => {
  const { context, requestId, signal, toolId } = request
  signal?.throwIfAborted()
  if (!WINDCHILL_INTERNAL_TOOL_IDS.has(toolId)) {
    return failureResponse(`Unsupported Windchill tool: ${toolId}`, 500)
  }

  try {
    const principal = await createExecutorPrincipalFromExecutionContext({
      context,
      audience: WINDCHILL_DELEGATION_AUDIENCE,
    })
    signal?.throwIfAborted()
    const input = parseInput(request.input)
    if (input instanceof Response) return input
    if (input.operation !== toolId) {
      return failureResponse('Windchill request operation does not match the selected tool', 400)
    }

    const output = await executeWindchillOperation(input, { principal, requestId, signal })
    signal?.throwIfAborted()
    return Response.json({ success: true, output } satisfies WindchillOperationResponse)
  } catch (error) {
    signal?.throwIfAborted()
    if (
      error instanceof InvalidInternalDelegationBindingError ||
      (error instanceof Error && error.message === 'Authentication required')
    ) {
      return failureResponse('Authentication required', 401)
    }
    logger.error(`[${requestId}] Windchill operation failed`, {
      operation: toolId,
      error: sanitizeWindchillError(getErrorMessage(error, 'Windchill operation failed')),
    })
    if (error instanceof WindchillOperationError) {
      return failureResponse(error.message, error.status)
    }
    if (error instanceof WindchillProviderError) {
      const status = error.status >= 400 && error.status <= 599 ? error.status : 502
      return failureResponse(error.message, status)
    }
    return failureResponse(
      getErrorMessage(error, 'Windchill operation failed'),
      isPayloadSizeLimitError(error) ? 413 : 500
    )
  }
}
