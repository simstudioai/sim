import type {
  LaunchDarklyGetAuditLogParams,
  LaunchDarklyGetAuditLogResponse,
} from '@/tools/launchdarkly/types'
import { AUDIT_LOG_ENTRY_OUTPUT_PROPERTIES } from '@/tools/launchdarkly/types'
import type { ToolConfig } from '@/tools/types'

export const launchDarklyGetAuditLogTool: ToolConfig<
  LaunchDarklyGetAuditLogParams,
  LaunchDarklyGetAuditLogResponse
> = {
  id: 'launchdarkly_get_audit_log',
  name: 'LaunchDarkly Get Audit Log',
  description: 'List audit log entries from your LaunchDarkly account.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LaunchDarkly API key',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of entries to return (default 10, max 20)',
    },
    spec: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter expression (e.g., "resourceType:flag")',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.limit) queryParams.set('limit', String(params.limit))
      if (params.spec) queryParams.set('spec', params.spec)
      const qs = queryParams.toString()
      return `https://app.launchdarkly.com/api/v2/auditlog${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: params.apiKey.trim(),
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }))
      return { success: false, output: { entries: [], totalCount: 0 }, error: error.message }
    }

    const data = await response.json()
    const entries = (data.items ?? []).map((item: Record<string, unknown>) => {
      const member = item.member as Record<string, unknown> | undefined
      const target = item.target as Record<string, unknown> | undefined
      return {
        id: (item._id as string) ?? null,
        date: item.date ?? null,
        kind: item.kind ?? null,
        name: item.name ?? null,
        description: item.description ?? null,
        shortDescription: item.shortDescription ?? null,
        memberEmail: member?.email ?? null,
        targetName: target?.name ?? null,
        targetKind: (target?.resources as string[] | undefined)?.[0] ?? null,
      }
    })

    return {
      success: true,
      output: {
        entries,
        totalCount: (data.totalCount as number) ?? entries.length,
      },
    }
  },

  outputs: {
    entries: {
      type: 'array',
      description: 'List of audit log entries',
      items: {
        type: 'object',
        properties: AUDIT_LOG_ENTRY_OUTPUT_PROPERTIES,
      },
    },
    totalCount: { type: 'number', description: 'Total number of audit log entries' },
  },
}
