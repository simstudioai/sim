import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SplunkGetFiredAlertsParams, SplunkGetFiredAlertsResponse } from '@/tools/splunk/types'
import {
  asNumber,
  asString,
  buildSplunkHeaders,
  buildSplunkUrl,
  getEntryContent,
  getEntryName,
  getSplunkEntries,
  SPLUNK_CONNECTION_PARAMS,
  splunkPathSegment,
} from '@/tools/splunk/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Lists the unexpired triggered instances of one alert, by saved search name.
 *
 * The reference for `alerts/fired_alerts/{name}` states "Request parameters: None" and,
 * unlike its sibling collection endpoint, does not carry the "Pagination and filtering
 * parameters can be used with this method" note. No `count`/`offset` is sent, because a
 * Splunk handler may reject an unsupported argument outright rather than ignore it.
 */
export const getFiredAlertsTool: ToolConfig<
  SplunkGetFiredAlertsParams,
  SplunkGetFiredAlertsResponse
> = {
  id: 'splunk_get_fired_alerts',
  name: 'Splunk Get Fired Alerts',
  description:
    'List the unexpired triggered instances of a Splunk alert by saved search name, including severity, trigger time, and the search ID of each firing.',
  version: '1.0.0',

  params: {
    ...SPLUNK_CONNECTION_PARAMS,
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Name of the alerting saved search (e.g. Errors in the last 24 hours). Use - to return the fired alerts of every saved search — this endpoint documents "Request parameters: None", so there is no count or offset to bound that with. Name one saved search unless you really want all of them.',
    },
  },

  request: {
    url: (params) =>
      buildSplunkUrl(params, `/alerts/fired_alerts/${splunkPathSegment(params.name)}`),
    method: 'GET',
    headers: (params) => buildSplunkHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        firedAlerts: getSplunkEntries(data).map((entry) => {
          const content = getEntryContent(entry)
          return {
            name: getEntryName(entry),
            id: asString(entry.id),
            updated: asString(entry.updated),
            savedSearchName: asString(content.savedsearch_name),
            alertType: asString(content.alert_type),
            severity: asNumber(content.severity),
            sid: asString(content.sid),
            triggerTime: asNumber(content.trigger_time),
            triggerTimeRendered: asString(content.trigger_time_rendered),
            expirationTimeRendered: asString(content.expiration_time_rendered),
            triggeredAlerts: asNumber(content.triggered_alerts),
            actions: asString(content.actions),
          }
        }),
      },
    }
  },

  errorExtractor: ErrorExtractorId.SPLUNK_ERRORS,

  outputs: {
    firedAlerts: {
      type: 'array',
      description: 'Unexpired triggered instances of the alert',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the fired alert entry' },
          id: { type: 'string', description: 'Fully qualified REST URI of the entry' },
          updated: { type: 'string', description: 'Last update timestamp' },
          savedSearchName: {
            type: 'string',
            description: 'Name of the saved search that triggered the alert',
          },
          alertType: {
            type: 'string',
            description: 'Whether the alert was historical or real-time',
          },
          severity: { type: 'number', description: 'Severity level of the alert' },
          sid: { type: 'string', description: 'Search ID of the search that triggered the alert' },
          triggerTime: { type: 'number', description: 'Time the alert was triggered' },
          triggerTimeRendered: {
            type: 'string',
            description: 'Human-readable time the alert was triggered',
            optional: true,
          },
          expirationTimeRendered: {
            type: 'string',
            description: 'Human-readable time this triggered alert record expires',
            optional: true,
          },
          triggeredAlerts: {
            type: 'number',
            description: 'Number of alerts included in this triggered instance',
            optional: true,
          },
          actions: {
            type: 'string',
            description: 'Additional alert actions triggered by this alert',
          },
        },
      },
    },
  },
}
