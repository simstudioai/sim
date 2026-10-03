import type { z } from 'zod'
import { getValidationErrorMessage } from '@/lib/api/server'
import {
  checkGrafanaDataSourceHealth,
  type GrafanaOperationContext,
  updateGrafanaAlertRule,
  updateGrafanaDashboard,
  updateGrafanaFolder,
} from '@/lib/internal/grafana/operations'
import {
  grafanaCheckDataSourceHealthInputSchema,
  grafanaUpdateAlertRuleInputSchema,
  grafanaUpdateDashboardInputSchema,
  grafanaUpdateFolderInputSchema,
} from '@/lib/internal/grafana/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

async function executeOperation<Input>(
  schema: z.ZodType<Input>,
  input: unknown,
  context: GrafanaOperationContext,
  execute: (input: Input, context: GrafanaOperationContext) => Promise<unknown>
): Promise<Response> {
  context.signal?.throwIfAborted()
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return Response.json(
      {
        success: false,
        error: getValidationErrorMessage(parsed.error, 'Invalid request data'),
        details: parsed.error.issues,
      },
      { status: 400 }
    )
  }
  const result = await execute(parsed.data, context)
  context.signal?.throwIfAborted()
  const failed =
    typeof result === 'object' && result !== null && 'success' in result && result.success === false
  return Response.json(result, { status: failed ? 500 : 200 })
}

export const executeGrafanaTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!request.context.userId) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }
  const context = { requestId: request.requestId, signal: request.signal }
  switch (request.toolId) {
    case 'grafana_check_data_source_health':
      return executeOperation(
        grafanaCheckDataSourceHealthInputSchema,
        request.input,
        context,
        checkGrafanaDataSourceHealth
      )
    case 'grafana_update_alert_rule':
      return executeOperation(
        grafanaUpdateAlertRuleInputSchema,
        request.input,
        context,
        updateGrafanaAlertRule
      )
    case 'grafana_update_dashboard':
      return executeOperation(
        grafanaUpdateDashboardInputSchema,
        request.input,
        context,
        updateGrafanaDashboard
      )
    case 'grafana_update_folder':
      return executeOperation(
        grafanaUpdateFolderInputSchema,
        request.input,
        context,
        updateGrafanaFolder
      )
    default:
      return Response.json(
        { success: false, error: `Unsupported Grafana tool: ${request.toolId}` },
        { status: 500 }
      )
  }
}
