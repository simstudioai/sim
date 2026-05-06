import type { GrafanaUpdateDashboardParams } from '@/tools/grafana/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

// Using ToolResponse for intermediate state since this tool fetches existing data first
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
      description: 'Overwrite even if there is a version conflict',
    },
    message: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Commit message for this version',
    },
  },

  request: {
    // First, GET the existing dashboard
    url: (params) =>
      `${params.baseUrl.replace(/\/$/, '')}/api/dashboards/uid/${params.dashboardUid}`,
    method: 'GET',
    headers: (params) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }
      if (params.organizationId) {
        headers['X-Grafana-Org-Id'] = params.organizationId
      }
      return headers
    },
  },

  transformResponse: async (response: Response) => {
    // Store the existing dashboard data for postProcess to use
    const data = await response.json()
    return {
      success: true,
      output: {
        _existingDashboard: data.dashboard,
        _existingMeta: data.meta,
      },
    }
  },

  postProcess: async (result, params) => {
    // Merge user changes with existing dashboard and POST the complete object
    const existingDashboard = result.output._existingDashboard
    const existingMeta = result.output._existingMeta

    if (!existingDashboard || !existingDashboard.uid) {
      return {
        success: false,
        output: {},
        error: 'Failed to fetch existing dashboard',
      }
    }

    // Build the updated dashboard by merging existing data with new params
    const updatedDashboard: Record<string, any> = {
      ...existingDashboard,
    }

    // Apply user's changes
    if (params.title) updatedDashboard.title = params.title
    if (params.timezone) updatedDashboard.timezone = params.timezone
    if (params.refresh) updatedDashboard.refresh = params.refresh

    if (params.tags) {
      updatedDashboard.tags = params.tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t)
    }

    if (params.panels) {
      try {
        updatedDashboard.panels = JSON.parse(params.panels)
      } catch {
        // Keep existing panels if parse fails
      }
    }

    // Increment version for update
    if (existingDashboard.version) {
      updatedDashboard.version = existingDashboard.version
    }

    // Build the request body
    const body: Record<string, any> = {
      dashboard: updatedDashboard,
      overwrite: params.overwrite !== false,
    }

    // Use existing folder if not specified
    if (params.folderUid) {
      body.folderUid = params.folderUid
    } else if (existingMeta?.folderUid) {
      body.folderUid = existingMeta.folderUid
    }

    if (params.message) {
      body.message = params.message
    }

    // Make the POST request with the complete merged object
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }
    if (params.organizationId) {
      headers['X-Grafana-Org-Id'] = params.organizationId
    }

    const updateResponse = await fetch(`${params.baseUrl.replace(/\/$/, '')}/api/dashboards/db`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text()
      return {
        success: false,
        output: {},
        error: `Failed to update dashboard: ${errorText}`,
      }
    }

    const data = await updateResponse.json()

    return {
      success: true,
      output: {
        id: data.id,
        uid: data.uid,
        url: data.url,
        status: data.status,
        version: data.version,
        slug: data.slug,
      },
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
