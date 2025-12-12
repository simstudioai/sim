import { cancelDowntimeTool } from '@/tools/datadog/cancel_downtime'
import { createDowntimeTool } from '@/tools/datadog/create_downtime'
import { createEventTool } from '@/tools/datadog/create_event'
import { createMonitorTool } from '@/tools/datadog/create_monitor'
import { getMonitorTool } from '@/tools/datadog/get_monitor'
import { listDowntimesTool } from '@/tools/datadog/list_downtimes'
import { listMonitorsTool } from '@/tools/datadog/list_monitors'
import { muteMonitorTool } from '@/tools/datadog/mute_monitor'
import { queryLogsTool } from '@/tools/datadog/query_logs'
import { queryTimeseriesTool } from '@/tools/datadog/query_timeseries'
import { sendLogsTool } from '@/tools/datadog/send_logs'
import { submitMetricsTool } from '@/tools/datadog/submit_metrics'

export const datadogSubmitMetricsTool = submitMetricsTool
export const datadogQueryTimeseriesTool = queryTimeseriesTool
export const datadogCreateEventTool = createEventTool
export const datadogCreateMonitorTool = createMonitorTool
export const datadogGetMonitorTool = getMonitorTool
export const datadogListMonitorsTool = listMonitorsTool
export const datadogMuteMonitorTool = muteMonitorTool
export const datadogQueryLogsTool = queryLogsTool
export const datadogSendLogsTool = sendLogsTool
export const datadogCreateDowntimeTool = createDowntimeTool
export const datadogListDowntimesTool = listDowntimesTool
export const datadogCancelDowntimeTool = cancelDowntimeTool
