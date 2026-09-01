import { getErrorMessage } from '@sim/utils/errors'
import { executeSqsSend } from '@/lib/internal/sqs/operations'
import { sqsSendInputSchema } from '@/lib/internal/sqs/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeSqsTool: InternalToolOperationHandler = async ({ toolId, input, signal }) => {
  signal?.throwIfAborted()

  if (toolId !== 'sqs_send') {
    return Response.json({ error: `Unsupported SQS tool: ${toolId}` }, { status: 500 })
  }

  const parsed = sqsSendInputSchema.safeParse(input)
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid request data', details: parsed.error.issues },
      { status: 400 }
    )
  }

  try {
    return Response.json(await executeSqsSend(parsed.data, signal))
  } catch (error) {
    signal?.throwIfAborted()
    return Response.json(
      { error: `SQS send message failed: ${getErrorMessage(error, 'Unknown error occurred')}` },
      { status: 500 }
    )
  }
}
