import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { TwilioVoiceOperationError } from '@/lib/internal/twilio-voice/errors'
import { getTwilioRecording } from '@/lib/internal/twilio-voice/operations'

const inputSchema = z.object({
  accountSid: z.string().min(1, 'Account SID is required'),
  authToken: z.string().min(1, 'Auth token is required'),
  recordingSid: z.string().min(1, 'Recording SID is required'),
})

export const executeTwilioVoiceTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (request.toolId !== 'twilio_voice_get_recording') {
    return Response.json(
      { success: false, error: `Unsupported Twilio Voice tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  const parsed = inputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
  }
  try {
    return Response.json(
      await getTwilioRecording(parsed.data, {
        requestId: request.requestId,
        signal: request.signal,
      })
    )
  } catch (error) {
    request.signal?.throwIfAborted()
    const status = isPayloadSizeLimitError(error)
      ? 413
      : error instanceof TwilioVoiceOperationError
        ? error.status
        : 500
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Unknown error occurred') },
      { status }
    )
  }
}
