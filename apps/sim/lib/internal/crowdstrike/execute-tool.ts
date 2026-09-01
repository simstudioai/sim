import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { crowdstrikeQueryBodySchema } from '@/lib/api/contracts/tools/crowdstrike'
import { CrowdStrikeAuthError } from '@/lib/internal/crowdstrike/client'
import { executeCrowdStrikeRequest } from '@/lib/internal/crowdstrike/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

const logger = createLogger('CrowdStrikeToolExecution')

const CROWDSTRIKE_TOOL_IDS = new Set([
  'crowdstrike_create_indicators',
  'crowdstrike_delete_indicators',
  'crowdstrike_delete_rtr_session',
  'crowdstrike_execute_rtr_command',
  'crowdstrike_get_alert_details',
  'crowdstrike_get_case_details',
  'crowdstrike_get_host_group_details',
  'crowdstrike_get_indicator_details',
  'crowdstrike_get_rtr_command_status',
  'crowdstrike_get_sensor_aggregates',
  'crowdstrike_get_sensor_details',
  'crowdstrike_get_vulnerability_details',
  'crowdstrike_init_rtr_session',
  'crowdstrike_perform_host_action',
  'crowdstrike_perform_host_group_action',
  'crowdstrike_query_alerts',
  'crowdstrike_query_cases',
  'crowdstrike_query_host_groups',
  'crowdstrike_query_indicators',
  'crowdstrike_query_sensors',
  'crowdstrike_query_vulnerabilities',
  'crowdstrike_update_alerts',
  'crowdstrike_update_indicators',
])

function parseCrowdStrikeInput(input: unknown) {
  const parsed = crowdstrikeQueryBodySchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false as const,
      response: Response.json(
        {
          success: false,
          error: parsed.error.issues[0]?.message || 'Invalid request data',
          details: parsed.error.issues,
        },
        { status: 400 }
      ),
    }
  }

  return { success: true as const, data: parsed.data }
}

export const executeCrowdStrikeTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  signal,
}) => {
  signal?.throwIfAborted()
  if (!CROWDSTRIKE_TOOL_IDS.has(toolId)) {
    return Response.json({ error: `Unsupported CrowdStrike tool: ${toolId}` }, { status: 500 })
  }

  const parsed = parseCrowdStrikeInput(input)
  if (!parsed.success) return parsed.response

  try {
    const result = await executeCrowdStrikeRequest(parsed.data, signal)
    signal?.throwIfAborted()
    if (!result.ok) {
      return Response.json(
        { success: false, error: result.error },
        { status: result.status || 502 }
      )
    }

    return Response.json({ success: true, output: result.output })
  } catch (error) {
    signal?.throwIfAborted()
    const message = toError(error).message
    if (error instanceof CrowdStrikeAuthError) {
      logger.warn('CrowdStrike authentication failed', { error: message, status: error.status })
      return Response.json({ success: false, error: message }, { status: error.status })
    }

    logger.error('CrowdStrike request failed', { error: message })
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
