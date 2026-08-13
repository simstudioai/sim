import { nextPageKeyOutput, pageSizeOutput, totalCountOutput } from '@/tools/dynatrace/outputs'
import type {
  DynatraceGetAuditLogsParams,
  DynatraceGetAuditLogsResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  mapAuditLog,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const getAuditLogsTool: ToolConfig<
  DynatraceGetAuditLogsParams,
  DynatraceGetAuditLogsResponse
> = {
  id: 'dynatrace_get_audit_logs',
  name: 'Dynatrace Get Audit Logs',
  description:
    'Read the Dynatrace audit log — who changed which configuration, when, and whether it succeeded.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.DYNATRACE_ERRORS,

  params: {
    environmentUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Dynatrace environment URL (e.g., https://abc12345.live.dynatrace.com, or https://your-activegate:9999/e/abc12345 for Managed)',
    },
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dynatrace access token (dt0c01...) with the auditLogs.read scope',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Audit log filter, e.g. eventType("UPDATE"),user("someone@example.com"),category("CONFIG")',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Start of the timeframe as UTC milliseconds, ISO 8601, or a relative expression such as now-1d. Defaults to now-2w',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End of the timeframe in the same formats as From. Defaults to now',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'timestamp for oldest first, or -timestamp for newest first (default)',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Entries per page (max 5000, default 1000)',
    },
    nextPageKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for the next page. All other filters are ignored when it is set',
    },
  },

  request: {
    url: (params) =>
      params.nextPageKey
        ? buildDynatraceUrl(params.environmentUrl, '/auditlogs', {
            nextPageKey: params.nextPageKey,
          })
        : buildDynatraceUrl(params.environmentUrl, '/auditlogs', {
            filter: params.filter,
            from: params.from,
            to: params.to,
            sort: params.sort,
            pageSize: params.pageSize,
          }),
    method: 'GET',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)
    const auditLogs = Array.isArray(data.auditLogs)
      ? (data.auditLogs as Array<Record<string, unknown>>)
      : []

    return {
      success: true,
      output: {
        auditLogs: auditLogs.map(mapAuditLog),
        totalCount: (data.totalCount as number) ?? null,
        pageSize: (data.pageSize as number) ?? null,
        nextPageKey: (data.nextPageKey as string) ?? null,
      },
    }
  },

  outputs: {
    auditLogs: {
      type: 'array',
      description: 'Matching audit log entries',
      items: {
        type: 'object',
        properties: {
          logId: { type: 'string', description: 'Audit log entry ID' },
          eventType: { type: 'string', description: 'Type of the audited change' },
          category: { type: 'string', description: 'Category of the audited change' },
          entityId: { type: 'string', description: 'ID of the changed entity', nullable: true },
          environmentId: { type: 'string', description: 'Environment the change happened in' },
          user: { type: 'string', description: 'User or token that made the change' },
          userType: { type: 'string', description: 'Type of the acting user' },
          userOrigin: { type: 'string', description: 'Origin of the request', nullable: true },
          timestamp: { type: 'number', description: 'Change timestamp in UTC milliseconds' },
          success: { type: 'boolean', description: 'Whether the change succeeded' },
          message: { type: 'string', description: 'Description of the change', nullable: true },
          patch: {
            type: 'json',
            description:
              'JSON patch describing the change. Its shape follows whatever settings object was edited, so it is dynamic',
            nullable: true,
          },
          settingsSchemaId: {
            type: 'string',
            description: 'Settings schema ID (dt.settings.schema_id)',
            nullable: true,
          },
          settingsScopeId: {
            type: 'string',
            description: 'Settings scope ID (dt.settings.scope_id)',
            nullable: true,
          },
          settingsKey: {
            type: 'string',
            description: 'Settings key (dt.settings.key)',
            nullable: true,
          },
          settingsObjectId: {
            type: 'string',
            description: 'Settings object ID (dt.settings.object_id)',
            nullable: true,
          },
          settingsObjectSummary: {
            type: 'string',
            description: 'Settings object summary (dt.settings.object_summary)',
            nullable: true,
          },
          settingsScopeName: {
            type: 'string',
            description: 'Settings scope name (dt.settings.scope_name)',
            nullable: true,
          },
        },
      },
    },
    totalCount: totalCountOutput,
    pageSize: pageSizeOutput,
    nextPageKey: nextPageKeyOutput,
  },
}
