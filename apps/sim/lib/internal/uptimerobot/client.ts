import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { MAX_JSON_API_RESPONSE_BYTES } from '@/lib/core/security/input-validation.server'
import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import { UptimeRobotOperationError } from '@/lib/internal/uptimerobot/errors'
import { mapPsp, UPTIMEROBOT_API_BASE, type UptimeRobotPsp } from '@/tools/uptimerobot/types'

const logger = createLogger('UptimeRobotClient')

function providerMessage(text: string, status: number): string {
  try {
    const parsed = JSON.parse(text) as { message?: unknown }
    if (typeof parsed.message === 'string' && parsed.message) return parsed.message
  } catch {}
  return `UptimeRobot API error (HTTP ${status})`
}

export async function requestUptimeRobotPsp(args: {
  apiKey: string
  method: 'POST' | 'PATCH'
  path: string
  form: FormData
  signal?: AbortSignal
}): Promise<UptimeRobotPsp> {
  const { apiKey, method, path, form, signal } = args
  signal?.throwIfAborted()
  const response = await fetch(`${UPTIMEROBOT_API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    body: form,
    signal,
  })
  const text = await readResponseTextWithLimit(response, {
    maxBytes: MAX_JSON_API_RESPONSE_BYTES,
    label: 'UptimeRobot response',
    signal,
  })
  signal?.throwIfAborted()

  if (!response.ok) {
    const message = providerMessage(text, response.status)
    logger.error('UptimeRobot PSP request failed', { status: response.status, message })
    throw new UptimeRobotOperationError(message, response.status)
  }
  if (!text) {
    logger.error('UptimeRobot returned an empty PSP response')
    throw new UptimeRobotOperationError('UptimeRobot returned an unexpected response', 502)
  }

  let data: Record<string, unknown>
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Expected a PSP object response')
    }
    data = parsed as Record<string, unknown>
  } catch (error) {
    logger.error('UptimeRobot returned an unexpected PSP response', {
      error: getErrorMessage(error),
    })
    throw new UptimeRobotOperationError('UptimeRobot returned an unexpected response', 502)
  }

  if (typeof data.id !== 'number' || data.id < 1 || !data.friendlyName) {
    logger.error('UptimeRobot returned a PSP response without core fields')
    throw new UptimeRobotOperationError('UptimeRobot returned an unexpected response', 502)
  }
  return mapPsp(data)
}
