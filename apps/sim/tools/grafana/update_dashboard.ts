import type { GrafanaUpdateDashboardParams } from '@/tools/grafana/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export const updateDashboardTool: ToolConfig<GrafanaUpdateDashboardParams, ToolResponse> = {
  id: 'grafana_update_dashboard',
  name: 'Grafana Update Dashboard',
  description:
    'Update an existing dashboard. Fetches the current dashboard and merges your changes.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Grafana Service Account Token',
    },
    baseUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Grafana instance URL (e.g., https://your-grafana.com)',
    },
    organizationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Organization ID for multi-org Grafana instances (e.g., 1, 2)',
    },
    dashboardUid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UID of the dashboard to update (e.g., abc123def)',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New title for the dashboard',
    },
    folderUid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New folder UID to move the dashboard to (e.g., folder-abc123)',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of new tags',
    },
    timezone: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Dashboard timezone (e.g., browser, utc)',
    },
    refresh: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Auto-refresh interval (e.g., 5s, 1m, 5m)',
    },
    panels: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of panel configurations',
    },
    overwrite: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description:
        'Overwrite even if there is a version conflict (defaults to false to surface 412 conflicts)',
    },
    message: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Commit message for this version',
    },
  },

  request: {
    url: () => '/api/tools/grafana/update_dashboard',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      apiKey: params.apiKey,
      baseUrl: params.baseUrl,
      organizationId: params.organizationId,
      dashboardUid: params.dashboardUid,
      title: params.title,
      folderUid: params.folderUid,
      tags: params.tags,
      timezone: params.timezone,
      refresh: params.refresh,
      panels: params.panels,
      overwrite: params.overwrite,
      message: params.message,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: data.success ?? true,
      output: data.output ?? {},
      ...(data.error ? { error: data.error } : {}),
    }
  },

  outputs: {
    id: {
      type: 'number',
      description: 'The numeric ID of the updated dashboard',
    },
    uid: {
      type: 'string',
      description: 'The UID of the updated dashboard',
    },
    url: {
      type: 'string',
      description: 'The URL path to the dashboard',
    },
    status: {
      type: 'string',
      description: 'Status of the operation (success)',
    },
    version: {
      type: 'number',
      description: 'The new version number of the dashboard',
    },
    slug: {
      type: 'string',
      description: 'URL-friendly slug of the dashboard',
    },
  },
}
