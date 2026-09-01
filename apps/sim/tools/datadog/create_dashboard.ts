import type { CreateDashboardParams, CreateDashboardResponse } from '@/tools/datadog/types'
import {
  datadogApiUrl,
  datadogErrorMessage,
  datadogHeaders,
  parseJsonParam,
  splitCommaList,
} from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const createDashboardTool: ToolConfig<CreateDashboardParams, CreateDashboardResponse> = {
  id: 'datadog_create_dashboard',
  name: 'Datadog Create Dashboard',
  description: 'Create a dashboard from a title, layout type, and widget definitions.',
  version: '1.0.0',

  params: {
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Title of the dashboard',
    },
    layoutType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Layout type: "ordered" or "free"',
    },
    widgets: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of widget definitions, e.g. [{"definition": {"type": "timeseries", "requests": [{"q": "avg:system.cpu.user{*}"}]}}]',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the dashboard',
    },
    notifyList: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated user handles to notify on dashboard changes',
    },
    templateVariables: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of template variable definitions, e.g. [{"name": "env", "prefix": "env", "available_values": ["prod"]}]',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated dashboard tags in the form "team:<name>" (max 5)',
    },
    reflowType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reflow type for ordered layouts: "auto" or "fixed"',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog API key',
    },
    applicationKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog Application key',
    },
    site: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Datadog site/region (default: datadoghq.com)',
    },
  },

  request: {
    url: (params) => datadogApiUrl(params.site, '/api/v1/dashboard'),
    method: 'POST',
    headers: datadogHeaders,
    body: (params) => {
      const body: Record<string, unknown> = {
        title: params.title,
        layout_type: params.layoutType,
        widgets: parseJsonParam<unknown[]>(params.widgets, 'widgets parameter') ?? [],
      }

      if (params.description) body.description = params.description
      if (params.reflowType) body.reflow_type = params.reflowType

      const notifyList = splitCommaList(params.notifyList)
      if (notifyList) body.notify_list = notifyList

      const tags = splitCommaList(params.tags)
      if (tags) body.tags = tags

      const templateVariables = parseJsonParam<unknown[]>(
        params.templateVariables,
        'templateVariables parameter'
      )
      if (templateVariables) body.template_variables = templateVariables

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      return {
        success: false,
        output: { dashboard: {} },
        error: await datadogErrorMessage(response),
      }
    }

    return {
      success: true,
      output: { dashboard: await response.json() },
    }
  },

  outputs: {
    dashboard: {
      type: 'object',
      description: 'The created dashboard',
      properties: {
        id: { type: 'string', description: 'Dashboard ID' },
        title: { type: 'string', description: 'Dashboard title' },
        layout_type: { type: 'string', description: 'Layout type: ordered or free' },
        url: { type: 'string', description: 'Dashboard URL path' },
        author_handle: { type: 'string', description: 'Handle of the dashboard author' },
        created_at: { type: 'string', description: 'Creation timestamp' },
        modified_at: { type: 'string', description: 'Modification timestamp' },
        widgets: { type: 'array', description: 'Widget definitions' },
      },
    },
  },
}
