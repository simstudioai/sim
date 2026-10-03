import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { z } from 'zod'
import { getValidationErrorMessage } from '@/lib/api/server'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import {
  executeStagehandAgent,
  executeStagehandExtract,
  type StagehandOperationContext,
} from '@/lib/internal/stagehand/operations'
import {
  stagehandAgentInputSchema,
  stagehandExtractInputSchema,
} from '@/lib/internal/stagehand/schema'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'

const logger = createLogger('StagehandToolExecution')

async function executeParsed<S extends z.ZodType>(
  request: InternalToolOperationCall,
  schema: S,
  execute: (input: z.output<S>, context: StagehandOperationContext) => Promise<Response>
): Promise<Response> {
  const parsed = schema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      {
        error: getValidationErrorMessage(parsed.error, 'Invalid request parameters'),
        details: parsed.error.issues,
      },
      { status: 400 }
    )
  }
  if (!request.context.userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return execute(parsed.data, { signal: request.signal })
}

export const executeStagehandTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  let serializedInput: string
  try {
    serializedInput = JSON.stringify(request.input) ?? ''
  } catch {
    return Response.json({ error: 'Invalid request parameters' }, { status: 400 })
  }
  if (Buffer.byteLength(serializedInput, 'utf8') > DEFAULT_MAX_JSON_BODY_BYTES) {
    return Response.json(
      {
        error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
      },
      { status: 413 }
    )
  }

  try {
    switch (request.toolId) {
      case 'stagehand_agent':
        return executeParsed(request, stagehandAgentInputSchema, executeStagehandAgent)
      case 'stagehand_extract':
        return executeParsed(request, stagehandExtractInputSchema, executeStagehandExtract)
      default:
        return Response.json(
          { error: `Unsupported Stagehand tool: ${request.toolId}` },
          { status: 500 }
        )
    }
  } catch (error) {
    request.signal?.throwIfAborted()
    const message = getErrorMessage(error, 'Unknown error')
    logger.error('Stagehand operation dispatch failed', {
      error: message,
      requestId: request.requestId,
      toolId: request.toolId,
    })
    return Response.json({ error: message }, { status: 500 })
  }
}
