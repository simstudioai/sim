import type {
  LogRocketGetAuditLogsParams,
  LogRocketGetAuditLogsResponse,
} from '@/tools/logrocket/types'
import { buildAppUrl, buildAuthHeaders, throwOnError } from '@/tools/logrocket/utils'
import type { ToolConfig } from '@/tools/types'

export const getAuditLogsTool: ToolConfig<
  LogRocketGetAuditLogsParams,
  LogRocketGetAuditLogsResponse
> = {
  id: 'logrocket_get_audit_logs',
  name: 'LogRocket Get Audit Logs',
  description:
    'Export audit log entries from LogRocket, recording who viewed sessions and what actions were taken. Paginated with a cursor.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LogRocket API key',
    },
    orgId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LogRocket organization ID',
    },
    appId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LogRocket project (app) ID',
    },
    apiHost: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'API host override for Private Cloud deployments',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of audit log records to return',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor from a previous page, used to fetch the next page',
    },
  },

  request: {
    url: (params) => {
      const url = buildAppUrl(params, 'audit/logs/')
      if (params.limit) url.searchParams.set('limit', params.limit.trim())
      if (params.cursor) url.searchParams.set('cursor', params.cursor.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => buildAuthHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = (await throwOnError(response, 'LogRocket Audit Log API')) as {
      has_next?: boolean
      cursor?: string | number
      logs?: Array<{
        time?: string
        created_date?: string
        user?: string
        action?: string
        description?: string
      }>
    } | null

    const logs = (data?.logs ?? []).map((log) => ({
      time: log.time ?? null,
      createdDate: log.created_date ?? null,
      user: log.user ?? null,
      action: log.action ?? null,
      description: log.description ?? null,
    }))

    return {
      success: true,
      output: {
        logs,
        cursor: data?.cursor === undefined || data.cursor === null ? null : String(data.cursor),
        hasNext: data?.has_next ?? false,
      },
    }
  },

  outputs: {
    logs: {
      type: 'array',
      description: 'Audit log entries',
      items: {
        type: 'object',
        properties: {
          time: { type: 'string', description: 'Formatted timestamp of the action' },
          createdDate: { type: 'string', description: 'ISO 8601 timestamp of the action' },
          user: { type: 'string', description: 'Email or system ID of the actor' },
          action: { type: 'string', description: 'Action taken, e.g. Viewed session' },
          description: { type: 'string', description: 'Action details, e.g. the session ID' },
        },
      },
    },
    cursor: {
      type: 'string',
      description: 'Opaque cursor for the next page of results',
      optional: true,
    },
    hasNext: {
      type: 'boolean',
      description: 'Whether more audit logs exist beyond this page',
    },
  },
}
