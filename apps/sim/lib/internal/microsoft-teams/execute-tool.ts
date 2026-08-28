import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'
import { getValidationErrorMessage } from '@/lib/api/server'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { MicrosoftTeamsOperationError } from '@/lib/internal/microsoft-teams/errors'
import {
  deleteMicrosoftTeamsChatMessage,
  writeMicrosoftTeamsChannelMessage,
  writeMicrosoftTeamsChatMessage,
} from '@/lib/internal/microsoft-teams/operations'
import {
  microsoftTeamsWriteChannelInputSchema,
  microsoftTeamsWriteChatInputSchema,
} from '@/lib/internal/microsoft-teams/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

const deleteInputSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  chatId: z.string().min(1, 'Chat ID is required'),
  messageId: z.string().min(1, 'Message ID is required'),
})

function inputSizeError(input: unknown): Response | null {
  let serialized: string
  try {
    serialized = JSON.stringify(input) ?? ''
  } catch {
    return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
  }
  if (Buffer.byteLength(serialized) <= DEFAULT_MAX_JSON_BODY_BYTES) return null
  return Response.json(
    {
      error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
    },
    { status: 413 }
  )
}

export const executeMicrosoftTeamsTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  const sizeError = inputSizeError(request.input)
  if (sizeError) return sizeError
  try {
    const context = {
      requestId: request.requestId,
      signal: request.signal,
      userId: request.context.userId,
    }
    switch (request.toolId) {
      case 'microsoft_teams_write_chat': {
        const parsed = microsoftTeamsWriteChatInputSchema.safeParse(request.input)
        if (!parsed.success) return validationErrorResponse(parsed.error)
        return Response.json(await writeMicrosoftTeamsChatMessage(parsed.data, context))
      }
      case 'microsoft_teams_write_channel': {
        const parsed = microsoftTeamsWriteChannelInputSchema.safeParse(request.input)
        if (!parsed.success) return validationErrorResponse(parsed.error)
        return Response.json(await writeMicrosoftTeamsChannelMessage(parsed.data, context))
      }
      case 'microsoft_teams_delete_chat_message': {
        const parsed = deleteInputSchema.safeParse(request.input)
        if (!parsed.success) return validationErrorResponse(parsed.error)
        return Response.json(
          await deleteMicrosoftTeamsChatMessage(parsed.data, { signal: request.signal })
        )
      }
      default:
        return Response.json(
          { success: false, error: `Unsupported Microsoft Teams tool: ${request.toolId}` },
          { status: 500 }
        )
    }
  } catch (error) {
    request.signal?.throwIfAborted()
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Unknown error occurred') },
      { status: error instanceof MicrosoftTeamsOperationError ? error.status : 500 }
    )
  }
}

function validationErrorResponse(error: z.ZodError): Response {
  return Response.json(
    { success: false, error: getValidationErrorMessage(error, 'Invalid request data') },
    { status: 400 }
  )
}
