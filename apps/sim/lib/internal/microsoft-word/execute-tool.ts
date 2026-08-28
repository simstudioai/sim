import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { z } from 'zod'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { GraphRequestError } from '@/lib/internal/microsoft-word/client'
import { MicrosoftWordInputError } from '@/lib/internal/microsoft-word/errors'
import {
  executeMicrosoftWordAppend,
  executeMicrosoftWordCreate,
  executeMicrosoftWordCreateFromTemplate,
  executeMicrosoftWordExportPdf,
  executeMicrosoftWordRead,
  executeMicrosoftWordReplaceText,
  executeMicrosoftWordUpdate,
  type MicrosoftWordOperationContext,
} from '@/lib/internal/microsoft-word/operations'
import {
  microsoftWordAppendInputSchema,
  microsoftWordCreateFromTemplateInputSchema,
  microsoftWordCreateInputSchema,
  microsoftWordExportPdfInputSchema,
  microsoftWordReadInputSchema,
  microsoftWordReplaceTextInputSchema,
  microsoftWordUpdateInputSchema,
} from '@/lib/internal/microsoft-word/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

const logger = createLogger('MicrosoftWordToolExecution')

async function executeOperation<S extends z.ZodType>(
  schema: S,
  input: unknown,
  execute: (input: z.output<S>, context: MicrosoftWordOperationContext) => Promise<unknown>,
  context: MicrosoftWordOperationContext,
  toolId: string
): Promise<Response> {
  context.signal?.throwIfAborted()
  let serializedInput: string
  try {
    serializedInput = JSON.stringify(input) ?? ''
  } catch {
    return Response.json({ error: 'Operation input must be valid JSON' }, { status: 400 })
  }
  if (Buffer.byteLength(serializedInput, 'utf8') > DEFAULT_MAX_JSON_BODY_BYTES) {
    return Response.json(
      {
        error: `Operation input exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
      },
      { status: 413 }
    )
  }
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid request data', details: parsed.error.issues },
      { status: 400 }
    )
  }

  try {
    const result = await execute(parsed.data, context)
    context.signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    context.signal?.throwIfAborted()
    const message = getErrorMessage(error, 'Unknown error occurred')
    logger.error('Microsoft Word operation failed', {
      error: message,
      requestId: context.requestId,
      toolId,
    })

    const status =
      error instanceof GraphRequestError || error instanceof MicrosoftWordInputError
        ? error.status
        : isPayloadSizeLimitError(error)
          ? 413
          : 500
    return Response.json({ success: false, error: message }, { status })
  }
}

export const executeMicrosoftWordTool: InternalToolOperationHandler = async (request) => {
  const { input, requestId, signal, toolId } = request
  const context: MicrosoftWordOperationContext = { requestId, signal }

  switch (toolId) {
    case 'microsoft_word_append':
      return executeOperation(
        microsoftWordAppendInputSchema,
        input,
        executeMicrosoftWordAppend,
        context,
        toolId
      )
    case 'microsoft_word_create':
      return executeOperation(
        microsoftWordCreateInputSchema,
        input,
        executeMicrosoftWordCreate,
        context,
        toolId
      )
    case 'microsoft_word_create_from_template':
      return executeOperation(
        microsoftWordCreateFromTemplateInputSchema,
        input,
        executeMicrosoftWordCreateFromTemplate,
        context,
        toolId
      )
    case 'microsoft_word_export_pdf':
      return executeOperation(
        microsoftWordExportPdfInputSchema,
        input,
        executeMicrosoftWordExportPdf,
        context,
        toolId
      )
    case 'microsoft_word_read':
      return executeOperation(
        microsoftWordReadInputSchema,
        input,
        executeMicrosoftWordRead,
        context,
        toolId
      )
    case 'microsoft_word_replace_text':
      return executeOperation(
        microsoftWordReplaceTextInputSchema,
        input,
        executeMicrosoftWordReplaceText,
        context,
        toolId
      )
    case 'microsoft_word_update':
      return executeOperation(
        microsoftWordUpdateInputSchema,
        input,
        executeMicrosoftWordUpdate,
        context,
        toolId
      )
    default:
      return Response.json(
        { success: false, error: `Unsupported Microsoft Word tool: ${toolId}` },
        { status: 500 }
      )
  }
}
