import type {
  SplunkListFiredAlertsParams,
  SplunkListFiredAlertsResponse,
} from '@/tools/splunk/types'
import {
  asNumber,
  asString,
  buildSplunkHeaders,
  buildSplunkUrl,
  getEntryContent,
  getEntryName,
  getSplunkEntries,
  getSplunkPaging,
  SPLUNK_CONNECTION_PARAMS,
  SPLUNK_OFFSET_OUTPUT,
  SPLUNK_TOTAL_OUTPUT,
} from '@/tools/splunk/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Lists the saved searches that currently have unexpired triggered alerts, with the
 * trigger count for each. Use Get Fired Alerts for the individual instances.
 */
export const listFiredAlertsTool: ToolConfig<
  SplunkListFiredAlertsParams,
  SplunkListFiredAlertsResponse
> = {
  id: 'splunk_list_fired_alerts',
  name: 'Splunk List Fired Alerts',
  description:
    'List the saved searches with currently triggered (unexpired) Splunk alerts and how many times each has fired.',
  version: '1.0.0',

  params: {
    ...SPLUNK_CONNECTION_PARAMS,
    count: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of entries to return (e.g. 50). 0 returns all.',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Index of the first entry to return, for pagination',
    },
  },

  request: {
    url: (params) =>
      buildSplunkUrl(params, '/alerts/fired_alerts', {
        count: params.count,
        offset: params.offset,
      }),
    method: 'GET',
    headers: (params) => buildSplunkHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const paging = getSplunkPaging(data)
    return {
      success: true,
      output: {
        alerts: getSplunkEntries(data).map((entry) => {
          const content = getEntryContent(entry)
          return {
            name: getEntryName(entry),
            id: asString(entry.id),
            updated: asString(entry.updated),
            triggeredAlertCount: asNumber(content.triggered_alert_count),
          }
        }),
        total: paging.total,
        offset: paging.offset,
      },
    }
  },

  outputs: {
    alerts: {
      type: 'array',
      description: 'Saved searches with currently triggered alerts',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the alerting saved search' },
          id: { type: 'string', description: 'Fully qualified REST URI of the entry' },
          updated: { type: 'string', description: 'Last update timestamp' },
          triggeredAlertCount: { type: 'number', description: 'Trigger count for this alert' },
        },
      },
    },
    total: SPLUNK_TOTAL_OUTPUT,
    offset: SPLUNK_OFFSET_OUTPUT,
  },
}
