import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { UptimeRobotOperationError } from '@/lib/internal/uptimerobot/errors'
import { createUptimeRobotPsp, updateUptimeRobotPsp } from '@/lib/internal/uptimerobot/operations'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'
import type { UptimeRobotPspResponse } from '@/tools/uptimerobot/types'

const sharedFields = {
  apiKey: z.string().min(1),
  monitorIds: z.string().optional(),
  status: z.enum(['ENABLED', 'PAUSED']).optional(),
  password: z.string().max(255).optional(),
  customDomain: z.string().max(255).optional(),
  hideUrlLinks: z.boolean().optional(),
  noIndex: z.boolean().optional(),
  logo: FileInputSchema.optional(),
  icon: FileInputSchema.optional(),
}

const createPspSchema = z.object({
  ...sharedFields,
  friendlyName: z.string().min(1).max(255),
})

const updatePspSchema = z.object({
  ...sharedFields,
  pspId: z.number().int().min(1),
  friendlyName: z.string().max(255).optional(),
})

export const executeUptimeRobotTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!request.context.userId) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }
  if (request.toolId !== 'uptimerobot_create_psp' && request.toolId !== 'uptimerobot_update_psp') {
    return Response.json(
      { success: false, error: `Unsupported UptimeRobot tool: ${request.toolId}` },
      { status: 500 }
    )
  }

  try {
    const context = {
      userId: request.context.userId,
      requestId: request.requestId,
      signal: request.signal,
    }
    let result: UptimeRobotPspResponse
    if (request.toolId === 'uptimerobot_create_psp') {
      const parsed = createPspSchema.safeParse(request.input)
      if (!parsed.success) {
        return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
      }
      result = await createUptimeRobotPsp(parsed.data, context)
    } else {
      const parsed = updatePspSchema.safeParse(request.input)
      if (!parsed.success) {
        return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
      }
      result = await updateUptimeRobotPsp(parsed.data, context)
    }
    request.signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof UptimeRobotOperationError) {
      return Response.json({ success: false, error: error.message }, { status: error.status })
    }
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Unknown error') },
      { status: 500 }
    )
  }
}
