import { createLogger } from '@sim/logger'
import { requestUptimeRobotPsp } from '@/lib/internal/uptimerobot/client'
import { appendUptimeRobotPspImage } from '@/lib/internal/uptimerobot/file-input'
import type {
  UptimeRobotCreatePspParams,
  UptimeRobotPspResponse,
  UptimeRobotUpdatePspParams,
} from '@/tools/uptimerobot/types'

const logger = createLogger('UptimeRobotOperations')

export interface UptimeRobotOperationContext {
  userId: string
  requestId: string
  signal?: AbortSignal
}

function appendTextFields(
  form: FormData,
  input: UptimeRobotCreatePspParams | UptimeRobotUpdatePspParams
): void {
  if (input.friendlyName) form.append('friendlyName', input.friendlyName)
  if (input.status) form.append('status', input.status)
  if (input.password) form.append('password', input.password)
  if (input.customDomain) form.append('customDomain', input.customDomain)
  if (typeof input.hideUrlLinks === 'boolean') {
    form.append('hideUrlLinks', String(input.hideUrlLinks))
  }
  if (typeof input.noIndex === 'boolean') form.append('noIndex', String(input.noIndex))
  if (input.monitorIds) {
    for (const id of input.monitorIds.split(',')) {
      const trimmed = id.trim()
      if (trimmed) form.append('monitorIds', trimmed)
    }
  }
}

async function executePspOperation(args: {
  input: UptimeRobotCreatePspParams | UptimeRobotUpdatePspParams
  method: 'POST' | 'PATCH'
  path: string
  context: UptimeRobotOperationContext
}): Promise<UptimeRobotPspResponse> {
  const { input, method, path, context } = args
  context.signal?.throwIfAborted()
  const form = new FormData()
  appendTextFields(form, input)
  if (input.logo) {
    await appendUptimeRobotPspImage({
      form,
      field: 'logo',
      file: input.logo,
      userId: context.userId,
      requestId: context.requestId,
      logger,
      signal: context.signal,
    })
  }
  if (input.icon) {
    await appendUptimeRobotPspImage({
      form,
      field: 'icon',
      file: input.icon,
      userId: context.userId,
      requestId: context.requestId,
      logger,
      signal: context.signal,
    })
  }
  const psp = await requestUptimeRobotPsp({
    apiKey: input.apiKey,
    method,
    path,
    form,
    signal: context.signal,
  })
  return { success: true, output: { psp } }
}

export function createUptimeRobotPsp(
  input: UptimeRobotCreatePspParams,
  context: UptimeRobotOperationContext
): Promise<UptimeRobotPspResponse> {
  return executePspOperation({ input, method: 'POST', path: '/psps', context })
}

export function updateUptimeRobotPsp(
  input: UptimeRobotUpdatePspParams,
  context: UptimeRobotOperationContext
): Promise<UptimeRobotPspResponse> {
  return executePspOperation({
    input,
    method: 'PATCH',
    path: `/psps/${input.pspId}`,
    context,
  })
}
