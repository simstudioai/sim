import { smsSendBodySchema } from '@/lib/api/contracts/tools/communication/messaging'
import { env } from '@/lib/core/config/env'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { sendSMS } from '@/lib/messaging/sms/service'

export const executeSmsTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  context,
  signal,
}) => {
  signal?.throwIfAborted()
  if (toolId !== 'sms_send') {
    return Response.json({ error: `Unsupported SMS tool: ${toolId}` }, { status: 500 })
  }
  if (!context.userId) {
    return Response.json({ success: false, message: 'Authentication required' }, { status: 401 })
  }

  const parsed = smsSendBodySchema.safeParse(input)
  if (!parsed.success) {
    return Response.json(
      { success: false, message: parsed.error.issues[0]?.message ?? 'Invalid request data' },
      { status: 400 }
    )
  }

  const fromNumber = env.TWILIO_PHONE_NUMBER
  if (!fromNumber) {
    return Response.json(
      { success: false, message: 'SMS sending failed: No phone number configured.' },
      { status: 500 }
    )
  }

  const result = await sendSMS({ ...parsed.data, from: fromNumber })
  signal?.throwIfAborted()
  return Response.json(result)
}
